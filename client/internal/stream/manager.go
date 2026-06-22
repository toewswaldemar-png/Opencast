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
	StreamID   string
	DeviceID   string
	IngestURL  string
	Format     audio.Format
	Bitrate    int
	SampleRate uint32
	Channels   uint16
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

	go m.pumpAudio(ctx, cap, enc)
	go m.pumpIngest(ctx, sess)
	go m.pumpLevels(ctx, cfg.StreamID, cap)

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

func (m *Manager) pumpIngest(ctx context.Context, sess *session) {
	defer close(sess.done)

	cfg := sess.cfg
	contentType := cfg.Format.ContentType()

	m.notifyStatus(cfg.StreamID, true, false, 0, 0)

	// io.Pipe connects the encoder output to the HTTP PUT body
	pr, pw := io.Pipe()

	// Goroutine copies encoder output to pipe
	go func() {
		_, err := io.Copy(pw, sess.encoder.Output())
		pw.CloseWithError(err)
	}()

	// Build request and stream
	log.Printf("[stream/%s] Ingest starten → %s", cfg.StreamID, cfg.IngestURL)

	err := wsclient.PutIngest(ctx, cfg.IngestURL, contentType, pr)
	if err != nil && ctx.Err() == nil {
		log.Printf("[stream/%s] Ingest Fehler: %v", cfg.StreamID, err)
	}

	pr.Close()
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

	sess.cancel()
	sess.capturer.Stop()
	sess.encoder.Close()

	select {
	case <-sess.done:
	case <-time.After(5 * time.Second):
	}
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
