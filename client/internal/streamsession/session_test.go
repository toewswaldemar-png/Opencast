package streamsession_test

import (
	"bytes"
	"context"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"client/internal/audio"
	"client/internal/pcmbuffer"
	"client/internal/streamsession"
)

// ── Fake encoder ──────────────────────────────────────────────────────────────

type fakeEncoder struct {
	written []byte
	mu      sync.Mutex
	pr      *io.PipeReader
	pw      *io.PipeWriter
	closed  atomic.Bool
}

func newFakeEncoder() *fakeEncoder {
	pr, pw := io.Pipe()
	return &fakeEncoder{pr: pr, pw: pw}
}

func (e *fakeEncoder) Write(p []byte) (int, error) {
	e.mu.Lock()
	e.written = append(e.written, p...)
	e.mu.Unlock()
	// Echo input bytes as "encoded" output so runIngest sees data.
	n, err := e.pw.Write(p)
	return n, err
}

func (e *fakeEncoder) Output() io.Reader { return e.pr }

func (e *fakeEncoder) Close() error {
	if e.closed.CompareAndSwap(false, true) {
		e.pw.Close()
	}
	return nil
}

func (e *fakeEncoder) Written() []byte {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]byte, len(e.written))
	copy(out, e.written)
	return out
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const (
	testFrameSize  = 1024
	testSampleRate = 48000
	testCapFrames  = 50
)

func newTestBuf() *pcmbuffer.PCMBuffer {
	return pcmbuffer.New(testFrameSize, testCapFrames)
}

func newTestConfig(enc *fakeEncoder, ingestFn func(context.Context, string, string, io.Reader) error) streamsession.Config {
	return streamsession.Config{
		SampleRate:  testSampleRate,
		FrameSize:   testFrameSize,
		Format:      audio.FormatMP3,
		Bitrate:     128,
		IngestURL:   "http://test/ingest/1",
		IngestFunc:  ingestFn,
		NewEncoderFn: func(_ audio.EncoderConfig) (streamsession.Encoder, error) {
			return enc, nil
		},
	}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// TestStart_ConnectsIcecast_Immediately verifies that IngestFunc is called
// as soon as Start() returns, before any PCM is written to the buffer.
func TestStart_ConnectsIcecast_Immediately(t *testing.T) {
	enc := newFakeEncoder()
	ingestCalled := make(chan struct{})

	cfg := newTestConfig(enc, func(ctx context.Context, url, ct string, r io.Reader) error {
		close(ingestCalled)
		<-ctx.Done()
		return nil
	})

	buf := newTestBuf()
	sess := streamsession.New(cfg, buf, streamsession.Callbacks{})
	if err := sess.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer sess.Stop()

	select {
	case <-ingestCalled:
		// ✓ IngestFunc called without any PCM written to buffer
	case <-time.After(500 * time.Millisecond):
		t.Fatal("IngestFunc not called within 500ms")
	}
}

// TestStart_ReadsSilence_WhenBufferEmpty verifies that the ticker feeds silence
// to the encoder when the PCMBuffer has no data.
func TestStart_ReadsSilence_WhenBufferEmpty(t *testing.T) {
	enc := newFakeEncoder()

	cfg := newTestConfig(enc, func(ctx context.Context, url, ct string, r io.Reader) error {
		io.Copy(io.Discard, r)
		return nil
	})

	buf := newTestBuf()
	sess := streamsession.New(cfg, buf, streamsession.Callbacks{})
	if err := sess.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Let ticker fire a few times (frameDuration ≈ 5.33ms → wait 30ms = ~5 frames).
	time.Sleep(30 * time.Millisecond)
	sess.Stop()

	written := enc.Written()
	if len(written) == 0 {
		t.Fatal("encoder received no data")
	}
	// All bytes should be zero (silence).
	for i, b := range written {
		if b != 0 {
			t.Fatalf("written[%d] = %d, want 0 (silence)", i, b)
			break
		}
	}
}

// TestStart_ReadsPCM_WhenBufferHasData verifies that real PCM reaches the encoder.
func TestStart_ReadsPCM_WhenBufferHasData(t *testing.T) {
	enc := newFakeEncoder()

	cfg := newTestConfig(enc, func(ctx context.Context, url, ct string, r io.Reader) error {
		io.Copy(io.Discard, r)
		return nil
	})

	buf := newTestBuf()

	// Pre-fill buffer with non-zero marker frames.
	marker := make([]byte, testFrameSize)
	for i := range marker {
		marker[i] = 0xAB
	}
	for i := 0; i < 5; i++ {
		buf.WriteFrame(marker)
	}

	sess := streamsession.New(cfg, buf, streamsession.Callbacks{})
	if err := sess.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Wait long enough for all 5 marker frames to be read (5 × 5.33ms ≈ 27ms).
	time.Sleep(60 * time.Millisecond)
	sess.Stop()

	written := enc.Written()
	// First 5 frames should contain the marker byte.
	markerFrames := 0
	for i := 0; i+testFrameSize <= len(written); i += testFrameSize {
		if written[i] == 0xAB {
			markerFrames++
		}
	}
	if markerFrames < 5 {
		t.Errorf("got %d marker frames, want ≥ 5", markerFrames)
	}
}

// TestStop_IsIdempotent verifies that Stop can be called multiple times safely.
func TestStop_IsIdempotent(t *testing.T) {
	enc := newFakeEncoder()
	cfg := newTestConfig(enc, func(ctx context.Context, url, ct string, r io.Reader) error {
		<-ctx.Done()
		return nil
	})

	sess := streamsession.New(cfg, newTestBuf(), streamsession.Callbacks{})
	if err := sess.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	sess.Stop()
	sess.Stop() // must not panic
}

// TestStop_BeforeStart_IsNoop verifies that Stop on an unstarted session is safe.
func TestStop_BeforeStart_IsNoop(t *testing.T) {
	enc := newFakeEncoder()
	cfg := newTestConfig(enc, nil)
	sess := streamsession.New(cfg, newTestBuf(), streamsession.Callbacks{})
	sess.Stop() // must not panic or block
}

// TestOnStatus_CalledOnStartAndStop verifies status transitions.
func TestOnStatus_CalledOnStartAndStop(t *testing.T) {
	enc := newFakeEncoder()

	var statuses []bool
	var mu sync.Mutex

	cfg := newTestConfig(enc, func(ctx context.Context, url, ct string, r io.Reader) error {
		io.Copy(io.Discard, r)
		return nil
	})

	cbs := streamsession.Callbacks{
		OnStatus: func(running, connected bool, bytesSent int64, uptime time.Duration) {
			mu.Lock()
			statuses = append(statuses, running)
			mu.Unlock()
		},
	}

	sess := streamsession.New(cfg, newTestBuf(), cbs)
	if err := sess.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	sess.Stop()

	mu.Lock()
	defer mu.Unlock()
	if len(statuses) == 0 {
		t.Fatal("OnStatus never called")
	}
	// First call: running=true; last call: running=false.
	if !statuses[0] {
		t.Error("first OnStatus: running should be true")
	}
	if statuses[len(statuses)-1] {
		t.Error("last OnStatus: running should be false")
	}
}

// TestIngestError_CallsOnError verifies error propagation.
func TestIngestError_CallsOnError(t *testing.T) {
	enc := newFakeEncoder()

	errCh := make(chan string, 1)
	cfg := newTestConfig(enc, func(ctx context.Context, url, ct string, r io.Reader) error {
		return bytes.ErrTooLarge
	})

	cbs := streamsession.Callbacks{
		OnError: func(msg string) { errCh <- msg },
		OnStatus: func(running, connected bool, bytesSent int64, uptime time.Duration) {},
	}

	sess := streamsession.New(cfg, newTestBuf(), cbs)
	if err := sess.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer sess.Stop()

	select {
	case msg := <-errCh:
		if msg == "" {
			t.Error("OnError called with empty message")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("OnError not called after ingest failure")
	}
}
