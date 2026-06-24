//go:build windows

package stream

import (
	"context"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"client/internal/audio"
	"client/internal/wsclient"
)

// Config is the streaming configuration for one session.
type Config struct {
	StreamID     string
	DeviceID     string
	IngestURL    string
	Format       audio.Format
	Bitrate      int
	SampleRate   uint32
	ChannelLeft  uint16
	ChannelRight uint16
}

// StatusCallback is called on stream status changes.
type StatusCallback func(streamID string, running, connected bool, bytesSent int64, uptime time.Duration)

type session struct {
	cfg       Config
	cancel    context.CancelFunc
	done      chan struct{}
	capturer  audio.Capturer
	encoder   *audio.Encoder
	startedAt time.Time
}

// Manager runs zero or more concurrent streaming sessions.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*session
	statusCb StatusCallback
	errorCb  func(streamID, msg string)
	levelCb  func(streamID string, lvl audio.LevelUpdate)
}

func NewManager() *Manager {
	return &Manager{sessions: make(map[string]*session)}
}

func (m *Manager) SetStatusCallback(cb StatusCallback) {
	m.mu.Lock()
	m.statusCb = cb
	m.mu.Unlock()
}

func (m *Manager) SetErrorCallback(cb func(streamID, msg string)) {
	m.mu.Lock()
	m.errorCb = cb
	m.mu.Unlock()
}

func (m *Manager) SetLevelCallback(cb func(streamID string, lvl audio.LevelUpdate)) {
	m.mu.Lock()
	m.levelCb = cb
	m.mu.Unlock()
}

// Start launches a new streaming session.
func (m *Manager) Start(cfg Config) error {
	m.mu.Lock()
	if _, exists := m.sessions[cfg.StreamID]; exists {
		m.mu.Unlock()
		return fmt.Errorf("stream %q läuft bereits", cfg.StreamID)
	}
	m.mu.Unlock()

	cap := audio.NewCapturer(audio.CaptureConfig{
		DeviceID:    cfg.DeviceID,
		SampleRate:  cfg.SampleRate,
		ChannelLeft:  cfg.ChannelLeft,
		ChannelRight: cfg.ChannelRight,
		BitDepth:    16,
	})

	log.Printf("[stream/%s] Capturer wird gestartet…", cfg.StreamID)
	ctx, cancel := context.WithCancel(context.Background())
	if err := cap.Start(ctx); err != nil {
		cancel()
		return fmt.Errorf("start capture: %w", err)
	}
	log.Printf("[stream/%s] Capturer läuft", cfg.StreamID)

	log.Printf("[stream/%s] Encoder wird erstellt…", cfg.StreamID)
	actual := cap.ActualConfig()
	enc, err := audio.NewEncoder(audio.EncoderConfig{
		Format:          cfg.Format,
		Bitrate:         cfg.Bitrate,
		SampleRate:      cfg.SampleRate,
		Channels:        2,
		InputSampleRate: actual.SampleRate,
		InputChannels:   2,
	})
	if err != nil {
		cancel()
		cap.Stop()
		return fmt.Errorf("create encoder: %w", err)
	}
	log.Printf("[stream/%s] Encoder läuft, Goroutinen werden gestartet…", cfg.StreamID)

	sess := &session{
		cfg:       cfg,
		cancel:    cancel,
		done:      make(chan struct{}),
		capturer:  cap,
		encoder:   enc,
		startedAt: time.Now(),
	}

	m.mu.Lock()
	m.sessions[cfg.StreamID] = sess
	m.mu.Unlock()

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[stream/%s] PANIC pumpAudio: %v", cfg.StreamID, r)
			}
		}()
		log.Printf("[stream/%s] pumpAudio gestartet", cfg.StreamID)
		m.pumpAudio(ctx, cap, enc)
		log.Printf("[stream/%s] pumpAudio beendet", cfg.StreamID)
	}()
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[stream/%s] PANIC pumpIngest: %v", cfg.StreamID, r)
			}
		}()
		log.Printf("[stream/%s] pumpIngest gestartet", cfg.StreamID)
		m.pumpIngest(ctx, sess)
	}()
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[stream/%s] PANIC pumpLevels: %v", cfg.StreamID, r)
			}
		}()
		log.Printf("[stream/%s] pumpLevels gestartet", cfg.StreamID)
		m.pumpLevels(ctx, cfg.StreamID, cap)
		log.Printf("[stream/%s] pumpLevels beendet", cfg.StreamID)
	}()

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
			if _, err := enc.Write(pcm); err != nil {
				return
			}
		}
	}
}

func (m *Manager) pumpIngest(ctx context.Context, sess *session) {
	defer close(sess.done)

	cfg := sess.cfg
	contentType := cfg.Format.ContentType()

	m.notifyStatus(cfg.StreamID, true, false, 0, 0)

	// io.Pipe connects the encoder output to the HTTP PUT body
	pr, pw := io.Pipe()

	// Goroutine copies encoder output to pipe; logs when first byte arrives.
	go func() {
		r := sess.encoder.Output()
		buf := make([]byte, 4096)
		first := true
		for {
			n, err := r.Read(buf)
			if n > 0 {
				if first {
					log.Printf("[stream/%s] erster Encoder-Output: %d Bytes", cfg.StreamID, n)
					first = false
				}
				if _, werr := pw.Write(buf[:n]); werr != nil {
					pw.CloseWithError(werr)
					return
				}
			}
			if err != nil {
				pw.CloseWithError(err)
				return
			}
		}
	}()

	// Build request and stream
	log.Printf("[stream/%s] Ingest starten → %s", cfg.StreamID, cfg.IngestURL)

	err := wsclient.PutIngest(ctx, cfg.IngestURL, contentType, pr)
	if err != nil && ctx.Err() == nil {
		log.Printf("[stream/%s] Ingest Fehler: %v", cfg.StreamID, err)
		m.notifyError(cfg.StreamID, err.Error())
	}

	pr.Close()

	// If Stop() hasn't already cleaned up (natural end: Icecast refused, network error, etc.),
	// remove the session here so a subsequent Start() isn't blocked.
	m.mu.Lock()
	stillInMap := m.sessions[cfg.StreamID] == sess
	if stillInMap {
		delete(m.sessions, cfg.StreamID)
	}
	m.mu.Unlock()
	if stillInMap {
		sess.cancel()
		sess.capturer.Stop()
		sess.encoder.Close()
	}

	m.notifyStatus(cfg.StreamID, false, false, 0, 0)
	log.Printf("[stream/%s] Ingest beendet", cfg.StreamID)
}

func (m *Manager) pumpLevels(ctx context.Context, streamID string, cap audio.Capturer) {
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
				cb(streamID, lvl)
			}
		}
	}
}

// Stop ends the streaming session with the given ID.
func (m *Manager) Stop(streamID string) {
	m.mu.Lock()
	sess, ok := m.sessions[streamID]
	if !ok {
		m.mu.Unlock()
		return
	}
	delete(m.sessions, streamID)
	m.mu.Unlock()

	log.Printf("[stream/%s] Stop: Capturer und Encoder werden beendet", streamID)
	sess.cancel()
	sess.capturer.Stop()
	sess.encoder.Close()

	select {
	case <-sess.done:
	case <-time.After(5 * time.Second):
	}
}

// IsRunning reports whether at least one streaming session is active.
func (m *Manager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions) > 0
}

// IsStreamRunning reports whether the session with the given ID is active.
func (m *Manager) IsStreamRunning(streamID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.sessions[streamID]
	return ok
}

// IsDeviceInUse reports whether any active session is capturing the given device.
func (m *Manager) IsDeviceInUse(deviceID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if s.cfg.DeviceID == deviceID {
			return true
		}
	}
	return false
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

func (m *Manager) notifyStatus(streamID string, running, connected bool, bytesSent int64, uptime time.Duration) {
	m.mu.Lock()
	cb := m.statusCb
	m.mu.Unlock()
	if cb != nil {
		cb(streamID, running, connected, bytesSent, uptime)
	}
}

func (m *Manager) notifyError(streamID, msg string) {
	m.mu.Lock()
	cb := m.errorCb
	m.mu.Unlock()
	if cb != nil {
		cb(streamID, msg)
	}
}
