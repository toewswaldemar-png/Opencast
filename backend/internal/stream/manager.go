//go:build windows || asio

package stream

import (
	"context"
	"fmt"
	"io"
	"log"
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
	Running      bool         `json:"running"`
	Connected    bool         `json:"connected"`
	Reconnecting bool         `json:"reconnecting"`
	Uptime       int64        `json:"uptime"` // nanoseconds
	BytesSent    int64        `json:"bytesSent"`
	Bitrate      int          `json:"bitrate"`
	Format       audio.Format `json:"format"`
}

// LevelCallback is called with audio level updates.
type LevelCallback func(audio.LevelUpdate)

// Manager orchestrates capture → encode → stream.
type Manager struct {
	mu           sync.Mutex
	running      bool
	reconnecting bool
	cancel       context.CancelFunc
	done         chan struct{}
	lastCfg      Config
	levelCb      LevelCallback
	capturer     audio.Capturer
	encoder      *audio.Encoder
	iceclient    *icecast.Client
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

	cap := audio.NewCapturer(audio.CaptureConfig{
		DeviceID:   cfg.DeviceID,
		SampleRate: cfg.SampleRate,
		Channels:   cfg.Channels,
		BitDepth:   16,
	})

	// Start capturer first so ActualConfig() reflects the negotiated device format.
	ctx, cancel := context.WithCancel(context.Background())
	if err := cap.Start(ctx); err != nil {
		cancel()
		return fmt.Errorf("start capture: %w", err)
	}

	actual := cap.ActualConfig()
	enc, err := audio.NewEncoder(audio.EncoderConfig{
		Format:          cfg.Format,
		Bitrate:         cfg.Bitrate,
		SampleRate:      cfg.SampleRate,
		Channels:        cfg.Channels,
		InputSampleRate: actual.SampleRate,
		InputChannels:   actual.Channels,
	})
	if err != nil {
		cancel()
		cap.Stop()
		return fmt.Errorf("create encoder: %w", err)
	}

	serverCfg := cfg.Server
	serverCfg.ContentType = cfg.Format.ContentType()
	ice := icecast.NewClient(serverCfg)

	if err := ice.Connect(); err != nil {
		cancel()
		cap.Stop()
		enc.Close()
		return fmt.Errorf("connect to icecast: %w", err)
	}

	m.running = true
	m.reconnecting = false
	m.cancel = cancel
	m.done = make(chan struct{})
	m.lastCfg = cfg
	m.capturer = cap
	m.encoder = enc
	m.iceclient = ice

	go m.pumpAudio(ctx, cap, enc)
	go m.pumpEncoded(ctx, enc.Output())
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

func (m *Manager) pumpEncoded(ctx context.Context, src io.Reader) {
	defer close(m.done)
	buf := make([]byte, 4096)

	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			m.mu.Lock()
			ice := m.iceclient
			m.mu.Unlock()

			if _, werr := ice.Write(buf[:n]); werr != nil {
				ice.Disconnect()
				if err := m.reconnect(ctx); err != nil {
					return // context cancelled
				}
				// Retry with new connection; drop the failed chunk
			}
		}
		if readErr != nil {
			return
		}
	}
}

// reconnect attempts to re-establish the Icecast connection with exponential
// backoff (1 s → 2 s → 4 s … capped at 30 s). Returns when connected or
// when ctx is cancelled.
func (m *Manager) reconnect(ctx context.Context) error {
	m.mu.Lock()
	m.reconnecting = true
	cfg := m.lastCfg
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		m.reconnecting = false
		m.mu.Unlock()
	}()

	backoff := time.Second
	for attempt := 1; ; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		log.Printf("[stream] Reconnect Versuch %d (nächster in %s)...", attempt, backoff)

		serverCfg := cfg.Server
		serverCfg.ContentType = cfg.Format.ContentType()
		newIce := icecast.NewClient(serverCfg)

		if err := newIce.Connect(); err == nil {
			log.Printf("[stream] Reconnect nach %d Versuch(en) erfolgreich", attempt)
			m.mu.Lock()
			m.iceclient = newIce
			m.mu.Unlock()
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}

		if backoff < 30*time.Second {
			backoff *= 2
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
	m.reconnecting = false
	m.capturer = nil
	m.encoder = nil
	m.iceclient = nil
	m.mu.Unlock()
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.running {
		return Status{Running: false}
	}

	var stats icecast.Stats
	if m.iceclient != nil {
		stats = m.iceclient.Stats()
	}

	return Status{
		Running:      true,
		Connected:    stats.Connected,
		Reconnecting: m.reconnecting,
		Uptime:       stats.Uptime.Nanoseconds(),
		BytesSent:    stats.BytesSent,
		Bitrate:      m.lastCfg.Bitrate,
		Format:       m.lastCfg.Format,
	}
}

func (m *Manager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}
