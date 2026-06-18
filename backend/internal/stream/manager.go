//go:build windows || asio

package stream

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"opencast/internal/audio"
	"opencast/internal/icecast"
)

// Config is the combined configuration for a streaming session.
type Config struct {
	DeviceID   string               `json:"deviceId"`
	SampleRate uint32               `json:"sampleRate"`
	Channels   uint16               `json:"channels"`
	Format     audio.Format         `json:"format"`
	Bitrate    int                  `json:"bitrate"`
	Server     icecast.ServerConfig `json:"server"`
}

type Status struct {
	Running   bool         `json:"running"`
	Connected bool         `json:"connected"`
	Uptime    int64        `json:"uptime"` // nanoseconds
	BytesSent int64        `json:"bytesSent"`
	Bitrate   int          `json:"bitrate"`
	Format    audio.Format `json:"format"`
}

// LevelCallback is called with audio level updates.
type LevelCallback func(audio.LevelUpdate)

// Manager orchestrates capture → encode → stream.
type Manager struct {
	mu        sync.Mutex
	running   bool
	cancel    context.CancelFunc
	done      chan struct{}
	lastCfg   Config
	levelCb   LevelCallback
	capturer  audio.Capturer
	encoder   *audio.Encoder
	iceclient *icecast.Client
}

func NewManager() *Manager {
	return &Manager{}
}

func (m *Manager) SetLevelCallback(cb LevelCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.levelCb = cb
}

// Start begins a streaming session with the given config.
func (m *Manager) Start(cfg Config) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return fmt.Errorf("stream already running")
	}

	captureCfg := audio.CaptureConfig{
		DeviceID:   cfg.DeviceID,
		SampleRate: cfg.SampleRate,
		Channels:   cfg.Channels,
		BitDepth:   16,
	}

	cap := audio.NewCapturer(captureCfg)

	enc, err := audio.NewEncoder(audio.EncoderConfig{
		Format:     cfg.Format,
		Bitrate:    cfg.Bitrate,
		SampleRate: cfg.SampleRate,
		Channels:   cfg.Channels,
	})
	if err != nil {
		return fmt.Errorf("create encoder: %w", err)
	}

	serverCfg := cfg.Server
	serverCfg.ContentType = cfg.Format.ContentType()
	ice := icecast.NewClient(serverCfg)

	if err := ice.Connect(); err != nil {
		enc.Close()
		return fmt.Errorf("connect to icecast: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	if err := cap.Start(ctx); err != nil {
		cancel()
		ice.Disconnect()
		enc.Close()
		return fmt.Errorf("start capture: %w", err)
	}

	m.running = true
	m.cancel = cancel
	m.done = make(chan struct{})
	m.lastCfg = cfg
	m.capturer = cap
	m.encoder = enc
	m.iceclient = ice

	go m.pumpAudio(ctx, cap, enc)
	go m.pumpEncoded(enc.Output(), ice)
	go m.pumpLevels(ctx, cap)

	return nil
}

func (m *Manager) pumpAudio(ctx context.Context, cap audio.Capturer, enc *audio.Encoder) {
	for {
		select {
		case <-ctx.Done():
			return
		case pcm, ok := <-cap.OutputCh():
			if !ok {
				return
			}
			enc.Write(pcm)
		}
	}
}

func (m *Manager) pumpEncoded(src io.Reader, ice *icecast.Client) {
	defer close(m.done)
	buf := make([]byte, 4096)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := ice.Write(buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func (m *Manager) pumpLevels(ctx context.Context, cap audio.Capturer) {
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
		}
	}
}

// Stop ends the current streaming session.
func (m *Manager) Stop() {
	m.mu.Lock()
	if !m.running {
		m.mu.Unlock()
		return
	}
	cancel := m.cancel
	cap := m.capturer
	enc := m.encoder
	ice := m.iceclient
	done := m.done
	m.mu.Unlock()

	cancel()
	cap.Stop()
	enc.Close()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}

	ice.Disconnect()

	m.mu.Lock()
	m.running = false
	m.capturer = nil
	m.encoder = nil
	m.iceclient = nil
	m.mu.Unlock()
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.running || m.iceclient == nil {
		return Status{Running: false}
	}

	s := m.iceclient.Stats()
	return Status{
		Running:   true,
		Connected: s.Connected,
		Uptime:    s.Uptime.Nanoseconds(),
		BytesSent: s.BytesSent,
		Bitrate:   m.lastCfg.Bitrate,
		Format:    m.lastCfg.Format,
	}
}

func (m *Manager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}
