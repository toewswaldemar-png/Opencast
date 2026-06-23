//go:build windows

package stream

import (
	"context"
	"fmt"
	"log"
	"sync"

	"client/internal/audio"
)

type MonitorConfig struct {
	DeviceID   string `json:"deviceId"`
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
}

type Monitor struct {
	opMu    sync.Mutex // serializes Start/Stop so Stop() waits for an in-progress Start()
	mu      sync.Mutex // protects running/cap state, also held by run() goroutine
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
	m.opMu.Lock()
	defer m.opMu.Unlock()

	if cfg.SampleRate == 0 { cfg.SampleRate = 44100 }
	if cfg.Channels == 0   { cfg.Channels = 2 }

	m.mu.Lock()
	if m.running && m.lastCfg == cfg {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	// Open the new capturer without holding m.mu (avoids deadlock with run()).
	// opMu ensures a concurrent Stop() blocks here and only runs after we return,
	// so the device is guaranteed free before manager.Start() opens it.
	// If the new device fails (e.g. ASIO exclusive conflict), we return early and
	// the old monitor keeps running — VU stays live instead of going dark.
	newCap := audio.NewCapturer(audio.CaptureConfig{
		DeviceID:   cfg.DeviceID,
		SampleRate: cfg.SampleRate,
		Channels:   cfg.Channels,
		BitDepth:   16,
	})
	newCtx, newCancel := context.WithCancel(context.Background())
	if err := newCap.Start(newCtx); err != nil {
		newCancel()
		return fmt.Errorf("monitor: %w", err)
	}

	log.Printf("[monitor] Capturer gestartet: device=%s sr=%d ch=%d", cfg.DeviceID, cfg.SampleRate, cfg.Channels)

	// New capturer is up — stop the old one and install the new.
	m.mu.Lock()
	if m.running {
		m.stopLocked() // drops and re-acquires m.mu internally
	}
	done := make(chan struct{})
	m.running = true
	m.lastCfg = cfg
	m.cancel  = newCancel
	m.done    = done
	m.cap     = newCap
	m.mu.Unlock()

	go m.run(newCtx, newCap, done)
	return nil
}

func (m *Monitor) run(ctx context.Context, cap audio.Capturer, done chan struct{}) {
	defer close(done) // use the captured channel, not m.done which stopLocked() nils out
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
	m.opMu.Lock()
	defer m.opMu.Unlock()

	m.mu.Lock()
	if !m.running {
		m.mu.Unlock()
		return
	}
	log.Printf("[monitor] Stop: device=%s", m.lastCfg.DeviceID)
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
