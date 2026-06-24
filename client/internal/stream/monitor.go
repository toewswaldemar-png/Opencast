//go:build windows

package stream

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"

	"client/internal/audio"
)

type MonitorConfig struct {
	DeviceID     string `json:"deviceId"`
	SampleRate   uint32 `json:"sampleRate"`
	ChannelLeft  uint16 `json:"channelLeft"`
	ChannelRight uint16 `json:"channelRight"`
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

// LastConfig returns the configuration the monitor is currently running with.
func (m *Monitor) LastConfig() MonitorConfig {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastCfg
}

func (m *Monitor) SetLevelCallback(cb func(audio.LevelUpdate)) {
	m.mu.Lock()
	m.levelCb = cb
	m.mu.Unlock()
}

func (m *Monitor) Start(cfg MonitorConfig) error {
	m.opMu.Lock()
	defer m.opMu.Unlock()

	if cfg.SampleRate == 0    { cfg.SampleRate = 44100 }
	if cfg.ChannelLeft == 0  { cfg.ChannelLeft = 1 }
	if cfg.ChannelRight == 0 { cfg.ChannelRight = 2 }

	m.mu.Lock()
	if m.running && m.lastCfg == cfg {
		m.mu.Unlock()
		return nil
	}
	// ASIO uses an exclusive global mutex (asioGlobalMu). Starting a new capturer
	// while the old one holds that lock would deadlock forever in Start().
	// Stop the old capturer first so the lock is free before newCap.Start() runs.
	if m.running && strings.HasPrefix(cfg.DeviceID, "asio:") {
		m.stopLocked() // releases and re-acquires m.mu
	}
	m.mu.Unlock()

	// Open the new capturer without holding m.mu (avoids deadlock with run()).
	// opMu ensures a concurrent Stop() blocks here and only runs after we return.
	// For non-ASIO devices: if the new capturer fails, the old one keeps running.
	newCap := audio.NewCapturer(audio.CaptureConfig{
		DeviceID:    cfg.DeviceID,
		SampleRate:  cfg.SampleRate,
		ChannelLeft:  cfg.ChannelLeft,
		ChannelRight: cfg.ChannelRight,
		BitDepth:    16,
	})
	newCtx, newCancel := context.WithCancel(context.Background())
	if err := newCap.Start(newCtx); err != nil {
		newCancel()
		return fmt.Errorf("monitor: %w", err)
	}

	log.Printf("[monitor] Capturer gestartet: device=%s sr=%d L=%d R=%d", cfg.DeviceID, cfg.SampleRate, cfg.ChannelLeft, cfg.ChannelRight)

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
