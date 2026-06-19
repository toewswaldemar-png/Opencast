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

// Config is the combined configuration for one streaming session.
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

type LevelCallback func(audio.LevelUpdate)

// session holds all runtime state for one active stream.
type session struct {
	cfg          Config
	cancel       context.CancelFunc
	done         chan struct{}
	capturer     audio.Capturer
	encoder      *audio.Encoder
	iceclient    *icecast.Client
	startedAt    time.Time
	reconnecting bool
}

// Manager runs zero or more concurrent streaming sessions, each identified
// by an opaque string ID (the server-entry ID from the frontend).
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*session
	levelCb  LevelCallback
}

func NewManager() *Manager {
	return &Manager{sessions: make(map[string]*session)}
}

func (m *Manager) SetLevelCallback(cb LevelCallback) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.levelCb = cb
}

// Start launches a new streaming session for the given id.
func (m *Manager) Start(id string, cfg Config) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[id]; exists {
		return fmt.Errorf("stream %q läuft bereits", id)
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

	sess := &session{
		cfg:       cfg,
		cancel:    cancel,
		done:      make(chan struct{}),
		capturer:  cap,
		encoder:   enc,
		iceclient: ice,
		startedAt: time.Now(),
	}
	m.sessions[id] = sess

	go m.pumpAudio(ctx, cap, enc)
	go m.pumpEncoded(id, ctx, sess, enc.Output())
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

func (m *Manager) pumpEncoded(id string, ctx context.Context, sess *session, src io.Reader) {
	defer close(sess.done)
	buf := make([]byte, 4096)

	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			m.mu.Lock()
			ice := sess.iceclient
			m.mu.Unlock()

			if _, werr := ice.Write(buf[:n]); werr != nil {
				ice.Disconnect()
				if err := m.reconnect(id, ctx, sess); err != nil {
					return
				}
			}
		}
		if readErr != nil {
			return
		}
	}
}

func (m *Manager) reconnect(id string, ctx context.Context, sess *session) error {
	m.mu.Lock()
	sess.reconnecting = true
	cfg := sess.cfg
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		sess.reconnecting = false
		m.mu.Unlock()
	}()

	backoff := time.Second
	for attempt := 1; ; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		log.Printf("[stream/%s] Reconnect Versuch %d (nächster in %s)…", id, attempt, backoff)

		serverCfg := cfg.Server
		serverCfg.ContentType = cfg.Format.ContentType()
		newIce := icecast.NewClient(serverCfg)

		if err := newIce.Connect(); err == nil {
			log.Printf("[stream/%s] Reconnect nach %d Versuch(en) erfolgreich", id, attempt)
			m.mu.Lock()
			sess.iceclient = newIce
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

// Stop ends the streaming session with the given id.
func (m *Manager) Stop(id string) {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	if !ok {
		m.mu.Unlock()
		return
	}
	delete(m.sessions, id)
	cancel := sess.cancel
	cap := sess.capturer
	enc := sess.encoder
	ice := sess.iceclient
	done := sess.done
	m.mu.Unlock()

	cancel()
	cap.Stop()
	enc.Close()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
	ice.Disconnect()
}

// StopAll stops every running session.
func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.Stop(id)
	}
}

// Status returns a snapshot of all running sessions.
func (m *Manager) Status() map[string]Status {
	m.mu.Lock()
	defer m.mu.Unlock()

	out := make(map[string]Status, len(m.sessions))
	for id, sess := range m.sessions {
		var stats icecast.Stats
		if sess.iceclient != nil {
			stats = sess.iceclient.Stats()
		}
		out[id] = Status{
			Running:      true,
			Connected:    stats.Connected,
			Reconnecting: sess.reconnecting,
			Uptime:       time.Since(sess.startedAt).Nanoseconds(),
			BytesSent:    stats.BytesSent,
			Bitrate:      sess.cfg.Bitrate,
			Format:       sess.cfg.Format,
		}
	}
	return out
}

// IsRunning reports whether the session with the given id is active.
func (m *Manager) IsRunning(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.sessions[id]
	return ok
}

// AnyRunning reports whether at least one session is active.
func (m *Manager) AnyRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions) > 0
}

// DeviceInUse reports whether any active session is capturing from deviceID.
func (m *Manager) DeviceInUse(deviceID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, sess := range m.sessions {
		if sess.cfg.DeviceID == deviceID {
			return true
		}
	}
	return false
}

// DeviceIDFor returns the capture device used by session id, or "" if not running.
func (m *Manager) DeviceIDFor(id string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if sess, ok := m.sessions[id]; ok {
		return sess.cfg.DeviceID
	}
	return ""
}
