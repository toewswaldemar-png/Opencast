//go:build windows

package stream

import (
	"context"
	"fmt"
	"sync"

	"client/internal/audio"
)

type MonitorConfig struct {
	DeviceID   string `json:"deviceId"`
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
}

type Monitor struct {
	mu      sync.Mutex
	running bool
	lastCfg MonitorConfig
	cancel  context.CancelFunc
	done    chan struct{}
	levelCb func(audio.LevelUpdate)
	cap     audio.Capturer
}

func NewMonitor() *Monitor { return &Monitor{} }

func (m *Monitor) SetLevelCallback(cb func(audio.LevelUpdate)) {
	m.mu.Lock()
	m.levelCb = cb
	m.mu.Unlock()
}

func (m *Monitor) Start(cfg MonitorConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Loop because stopLocked drops the mutex while waiting for cap.Stop().
	// A concurrent Start() can sneak in and install a new capturer in that window;
	// we must stop that one too before installing ours.
	for m.running {
		if m.lastCfg == cfg {
			return nil
		}
		m.stopLocked()
	}

	if cfg.SampleRate == 0 { cfg.SampleRate = 44100 }
	if cfg.Channels == 0   { cfg.Channels = 2 }

	cap := audio.NewCapturer(audio.CaptureConfig{
		DeviceID:   cfg.DeviceID,
		SampleRate: cfg.SampleRate,
		Channels:   cfg.Channels,
		BitDepth:   16,
	})

	ctx, cancel := context.WithCancel(context.Background())
	if err := cap.Start(ctx); err != nil {
		cancel()
		return fmt.Errorf("monitor: %w", err)
	}

	m.running = true
	m.lastCfg = cfg
	m.cancel  = cancel
	m.done    = make(chan struct{})
	m.cap     = cap

	go m.run(ctx, cap)
	return nil
}

func (m *Monitor) run(ctx context.Context, cap audio.Capturer) {
	defer close(m.done)
	for {
		select {
		case <-ctx.Done():
			return
		case lvl, ok := <-cap.LevelCh():
			if !ok { return }
			m.mu.Lock()
			cb := m.levelCb
			m.mu.Unlock()
			if cb != nil { cb(lvl) }
		case _, ok := <-cap.OutputCh():
			if !ok { return }
		}
	}
}

func (m *Monitor) Stop() {
	m.mu.Lock()
	if !m.running {
		m.mu.Unlock()
		return
	}
	m.stopLocked()
	m.mu.Unlock()
}

func (m *Monitor) stopLocked() {
	cancel := m.cancel
	cap    := m.cap
	done   := m.done
	m.running = false
	m.cap     = nil
	m.cancel  = nil
	m.done    = nil

	m.mu.Unlock()
	cancel()
	cap.Stop()
	<-done
	m.mu.Lock()
}
