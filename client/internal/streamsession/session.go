package streamsession

import (
	"context"
	"io"
	"log"
	"sync"
	"time"

	"client/internal/audio"
	"client/internal/pcmbuffer"
)

// Encoder abstracts audio.Encoder for testability.
type Encoder interface {
	Write([]byte) (int, error)
	Output() io.Reader
	Close() error
}

// Config holds all parameters the Session needs to encode and ingest audio.
// The PCM data in the buffer is always stereo s16le (2 channels, 2 bytes/sample).
type Config struct {
	// Input
	SampleRate uint32 // sample rate of the PCM data in the buffer
	FrameSize  int    // bytes per frame — must match the PCMBuffer frame size

	// Encoding
	Format           audio.Format
	Bitrate          int
	OutputSampleRate uint32 // encoder output sample rate (0 = same as SampleRate)

	// Ingest
	IngestURL  string
	IngestFunc func(ctx context.Context, url, contentType string, body io.Reader) error

	// Injectable for tests; defaults to audio.NewEncoder.
	NewEncoderFn func(audio.EncoderConfig) (Encoder, error)
}

// Callbacks are the event hooks provided by the Hub.
type Callbacks struct {
	OnStatus func(running, connected bool, bytesSent int64, uptime time.Duration)
	OnError  func(msg string)
}

// Session is the Clock-Master: owns the encoder, Icecast connection, and tick rate.
// It reads frames from a PCMBuffer at a fixed interval; the buffer provides silence
// when the audio source is unavailable, so the Icecast connection is never starved.
type Session struct {
	cfg Config
	buf *pcmbuffer.PCMBuffer
	cbs Callbacks

	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}

// New creates a Session. Call Start to begin encoding and ingesting.
func New(cfg Config, buf *pcmbuffer.PCMBuffer, cbs Callbacks) *Session {
	if cfg.NewEncoderFn == nil {
		cfg.NewEncoderFn = func(ecfg audio.EncoderConfig) (Encoder, error) {
			return audio.NewEncoder(ecfg)
		}
	}
	return &Session{cfg: cfg, buf: buf, cbs: cbs}
}

// Start launches the encoder and opens the Icecast connection immediately.
// Returns an error only if the encoder cannot be created.
func (s *Session) Start() error {
	outSR := s.cfg.OutputSampleRate
	if outSR == 0 {
		outSR = s.cfg.SampleRate
	}

	enc, err := s.cfg.NewEncoderFn(audio.EncoderConfig{
		Format:          s.cfg.Format,
		Bitrate:         s.cfg.Bitrate,
		SampleRate:      outSR,
		Channels:        2,
		InputSampleRate: s.cfg.SampleRate,
		InputChannels:   2,
	})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	s.mu.Lock()
	s.cancel = cancel
	s.done = done
	s.mu.Unlock()

	startedAt := time.Now()
	go s.runTicker(ctx, enc)
	go s.runIngest(ctx, enc, startedAt, done)

	return nil
}

// Stop cancels the session and waits for the ingest goroutine to finish.
func (s *Session) Stop() {
	s.mu.Lock()
	cancel := s.cancel
	done := s.done
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

// frameDuration returns the wall-clock duration represented by one frame.
func (s *Session) frameDuration() time.Duration {
	// FrameSize bytes / 2 channels / 2 bytes per sample = samples per frame
	samplesPerFrame := s.cfg.FrameSize / 4
	if samplesPerFrame == 0 || s.cfg.SampleRate == 0 {
		return 5 * time.Millisecond
	}
	return time.Duration(samplesPerFrame) * time.Second / time.Duration(s.cfg.SampleRate)
}

// runTicker is the clock master: ticks at frameDuration, reads from buffer, feeds the encoder.
func (s *Session) runTicker(ctx context.Context, enc Encoder) {
	frameBuf := make([]byte, s.cfg.FrameSize)
	ticker := time.NewTicker(s.frameDuration())
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			enc.Close()
			return
		case <-ticker.C:
			s.buf.ReadFrame(frameBuf)
			if _, err := enc.Write(frameBuf); err != nil {
				return
			}
		}
	}
}

// runIngest forwards encoder output to Icecast. Runs concurrently with runTicker.
func (s *Session) runIngest(ctx context.Context, enc Encoder, startedAt time.Time, done chan struct{}) {
	defer func() {
		close(done)
		if s.cbs.OnStatus != nil {
			s.cbs.OnStatus(false, false, 0, 0)
		}
		log.Printf("[session] Ingest beendet: %s", s.cfg.IngestURL)
	}()

	if s.cbs.OnStatus != nil {
		s.cbs.OnStatus(true, false, 0, 0)
	}

	pr, pw := io.Pipe()

	go func() {
		r := enc.Output()
		buf := make([]byte, 4096)
		first := true
		for {
			n, err := r.Read(buf)
			if n > 0 {
				if first {
					first = false
					log.Printf("[session] erster Encoder-Output: %d Bytes", n)
					if s.cbs.OnStatus != nil {
						s.cbs.OnStatus(true, true, 0, time.Since(startedAt))
					}
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

	log.Printf("[session] Ingest → %s", s.cfg.IngestURL)
	err := s.cfg.IngestFunc(ctx, s.cfg.IngestURL, s.cfg.Format.ContentType(), pr)
	if err != nil && ctx.Err() == nil {
		log.Printf("[session] Ingest Fehler: %v", err)
		if s.cbs.OnError != nil {
			s.cbs.OnError(err.Error())
		}
	}
	pr.Close()
}
