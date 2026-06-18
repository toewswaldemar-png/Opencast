//go:build windows || asio

package stream

import (
	"context"
	"fmt"
	"sync"

	"opencast/internal/audio"
)

type MonitorConfig struct {
	DeviceID   string `json:"deviceId"`
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
}

// Monitor captures audio and broadcasts levels without encoding or streaming.
type Monitor struct {
	mu       sync.Mutex
	running  bool
	lastCfg  MonitorConfig
	cancel   context.CancelFunc
	done     chan struct{}
	levelCb  LevelCallback
	capturer audio.Capturer
}

func NewMonitor() *Monitor {
	return &Monitor{}
}

func (m *Monitor) SetLevelCallback(cb LevelCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.levelCb = cb
}

func (m *Monitor) HasLastConfig() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastCfg.DeviceID != ""
}

func (m *Monitor) LastConfig() MonitorConfig {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastCfg
}

func (m *Monitor) Start(cfg MonitorConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		if m.lastCfg == cfg {
			return nil // already monitoring with same config
		}
		m.stopLocked()
	}

	if cfg.SampleRate == 0 {
		cfg.SampleRate = 44100
	}
	if cfg.Channels == 0 {
		cfg.Channels = 2
	}

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
	m.cancel = cancel
	m.done = make(chan struct{})
	m.capturer = cap

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
			if !ok {
				return
			}
			m.mu.Lock()
			cb := m.levelCb
			m.mu.Unlock()
			if cb != nil {
				cb(lvl)
			}
		case _, ok := <-cap.OutputCh():
			if !ok {
				return
			}
			// discard PCM — we only need levels
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

// stopLocked stops the monitor. Must be called with m.mu held.
func (m *Monitor) stopLocked() {
	cancel := m.cancel
	cap := m.capturer
	done := m.done
	m.running = false
	m.capturer = nil
	m.cancel = nil
	m.done = nil

	m.mu.Unlock()
	cancel()
	cap.Stop()
	<-done
	m.mu.Lock()
}
