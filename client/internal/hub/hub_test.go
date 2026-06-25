//go:build windows

package hub

import (
	"context"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"client/internal/audio"
)

// ── Mock Capturer ─────────────────────────────────────────────────────────────

type mockCapturer struct {
	cfg    audio.CaptureConfig
	pcmOut chan []byte
	levels chan audio.LevelUpdate
	doneCh chan struct{}

	startCalled atomic.Bool
	stopCalled  atomic.Bool
	doneOnce    sync.Once // guards doneCh so double-close never panics

	mu           sync.Mutex
	multiLevelCb func(int, []int16)
	pcmFanOutCb  func([]byte)
}

func newMockCapturer(cfg audio.CaptureConfig) audio.Capturer {
	return &mockCapturer{
		cfg:    cfg,
		pcmOut: make(chan []byte, 32),
		levels: make(chan audio.LevelUpdate, 16),
		doneCh: make(chan struct{}),
	}
}

func (m *mockCapturer) closeDone() { m.doneOnce.Do(func() { close(m.doneCh) }) }

func (m *mockCapturer) Start(ctx context.Context) error {
	m.startCalled.Store(true)
	go func() {
		<-ctx.Done()
		close(m.levels)
		close(m.pcmOut)
		m.closeDone()
	}()
	return nil
}

func (m *mockCapturer) Stop() {
	m.stopCalled.Store(true)
}

func (m *mockCapturer) Done() <-chan struct{}              { return m.doneCh }
func (m *mockCapturer) OutputCh() <-chan []byte            { return m.pcmOut }
func (m *mockCapturer) LevelCh() <-chan audio.LevelUpdate  { return m.levels }
func (m *mockCapturer) ActualConfig() audio.CaptureConfig  { return m.cfg }

func (m *mockCapturer) SetMultiLevelCallback(cb func(int, []int16)) {
	m.mu.Lock()
	m.multiLevelCb = cb
	m.mu.Unlock()
}

func (m *mockCapturer) SetPCMFanOutCallback(cb func([]byte)) {
	m.mu.Lock()
	m.pcmFanOutCb = cb
	m.mu.Unlock()
}

// sendLevel pushes a level update into the capturer's level channel.
func (m *mockCapturer) sendLevel(lvl audio.LevelUpdate) {
	select {
	case m.levels <- lvl:
	default:
	}
}

// fireMultiLevel invokes the installed multi-level callback directly (simulates ASIO callback).
func (m *mockCapturer) fireMultiLevel(frames int, pcm []int16) {
	m.mu.Lock()
	cb := m.multiLevelCb
	m.mu.Unlock()
	if cb != nil {
		cb(frames, pcm)
	}
}

// fireFanOut invokes the installed fan-out callback directly.
func (m *mockCapturer) fireFanOut(buf []byte) {
	m.mu.Lock()
	cb := m.pcmFanOutCb
	m.mu.Unlock()
	if cb != nil {
		cb(buf)
	}
}

// simulateCrash closes doneCh without going through the context, simulating
// an unexpected driver crash (capCtx still active).
func (m *mockCapturer) simulateCrash() { m.closeDone() }

// lastCapturer returns the most recently created mock from a capturing factory.
type capturerFactory struct {
	mu   sync.Mutex
	last *mockCapturer
	cfg  audio.CaptureConfig
}

func (f *capturerFactory) new(cfg audio.CaptureConfig) audio.Capturer {
	m := newMockCapturer(cfg).(*mockCapturer)
	m.cfg = cfg
	f.mu.Lock()
	f.last = m
	f.cfg = cfg
	f.mu.Unlock()
	return m
}

func (f *capturerFactory) getLast() *mockCapturer {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.last
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func hubWithMock(deviceID string) (*Hub, *capturerFactory) {
	fac := &capturerFactory{}
	h := newHub(deviceID)
	h.newCap = fac.new
	return h, fac
}

func waitCh(ch <-chan struct{}, timeout time.Duration) bool {
	select {
	case <-ch:
		return true
	case <-time.After(timeout):
		return false
	}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

func TestSubscribe_StartsCapturer(t *testing.T) {
	h, fac := hubWithMock("wasapi:test")

	got := make(chan audio.LevelUpdate, 1)
	err := h.Subscribe("m1", 1, 2, 48000, Callbacks{
		OnLevel: func(lvl audio.LevelUpdate) { got <- lvl },
	})
	if err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	mc := fac.getLast()
	if mc == nil || !mc.startCalled.Load() {
		t.Fatal("capturer not started")
	}

	// Simulate capturer sending a level update.
	mc.sendLevel(audio.LevelUpdate{Left: -10, Right: -12})

	select {
	case lvl := <-got:
		if lvl.Left != -10 {
			t.Errorf("level.Left = %v, want -10", lvl.Left)
		}
	case <-time.After(200 * time.Millisecond):
		t.Error("no level received")
	}
}

func TestUnsubscribe_StopsCapturer(t *testing.T) {
	h, fac := hubWithMock("wasapi:test")

	_ = h.Subscribe("m1", 1, 2, 48000, Callbacks{})
	mc := fac.getLast()

	h.Unsubscribe("m1")

	// capCancel should have been called → mc.doneCh closes.
	if !waitCh(mc.doneCh, 500*time.Millisecond) {
		t.Error("capturer doneCh not closed after last subscriber left")
	}
}

func TestASIO_ChannelUnion_TwoSubscribers(t *testing.T) {
	h, fac := hubWithMock("asio:{test-clsid}")

	_ = h.Subscribe("m1", 1, 2, 48000, Callbacks{}) // ch 0,1
	_ = h.Subscribe("m2", 3, 4, 48000, Callbacks{}) // ch 2,3

	mc := fac.getLast()
	if mc == nil {
		t.Fatal("capturer not created")
	}

	// The capturer config should request the union: channels [0,1,2,3].
	want := []int{0, 1, 2, 3}
	got := mc.cfg.Channels
	if len(got) != len(want) {
		t.Fatalf("channels = %v, want %v", got, want)
	}
	for i, c := range got {
		if c != want[i] {
			t.Errorf("channels[%d] = %d, want %d", i, c, want[i])
		}
	}
}

func TestASIO_ChannelUnion_SingleChannel(t *testing.T) {
	h, _ := hubWithMock("asio:{test-clsid}")
	_ = h.Subscribe("m1", 2, 2, 48000, Callbacks{}) // mono: L==R, ch 1

	h.mu.Lock()
	sub := h.subs["m1"]
	union := h.openChs
	h.mu.Unlock()

	// Union should be [1] (single channel).
	if len(union) != 1 || union[0] != 1 {
		t.Errorf("union = %v, want [1]", union)
	}
	// Both posL and posR point to index 0.
	if sub.posL != 0 || sub.posR != 0 {
		t.Errorf("posL=%d posR=%d, want both 0", sub.posL, sub.posR)
	}
}

func TestASIO_MultiLevelCb_DispatchesToSubscribers(t *testing.T) {
	h, fac := hubWithMock("asio:{test-clsid}")

	var gotM1, gotM2 atomic.Value
	_ = h.Subscribe("m1", 1, 1, 48000, Callbacks{
		OnLevel: func(lvl audio.LevelUpdate) { gotM1.Store(lvl) },
	})
	_ = h.Subscribe("m2", 2, 2, 48000, Callbacks{
		OnLevel: func(lvl audio.LevelUpdate) { gotM2.Store(lvl) },
	})

	mc := fac.getLast()
	// With 2 subscribers (monitor-only), multi-level callback should be installed.
	mc.mu.Lock()
	hasCb := mc.multiLevelCb != nil
	mc.mu.Unlock()
	if !hasCb {
		t.Fatal("multiLevelCb not installed")
	}

	// Fire: 2-channel PCM, ch0=+full, ch1=silence
	// nativeCh=2, posL=0,posR=0 for m1; posL=1,posR=1 for m2
	h.mu.Lock()
	h.nativeCh = 2
	h.mu.Unlock()

	pcm := make([]int16, 4*2) // 4 frames × 2 ch
	for f := 0; f < 4; f++ {
		pcm[f*2+0] = 32767  // ch0 full
		pcm[f*2+1] = 0      // ch1 silence
	}
	mc.fireMultiLevel(4, pcm)

	time.Sleep(10 * time.Millisecond) // callbacks are synchronous, just yield

	if lvl, ok := gotM1.Load().(audio.LevelUpdate); ok {
		if lvl.Left > -1 { // should be near 0 dBFS
			// ok
		} else {
			t.Errorf("m1 level.Left = %v, expected near 0dBFS", lvl.Left)
		}
	} else {
		t.Error("m1 did not receive level")
	}

	if lvl, ok := gotM2.Load().(audio.LevelUpdate); ok {
		if lvl.Left < -100 { // ch1 is silence → near -120 dBFS
			// ok
		} else {
			t.Errorf("m2 level.Left = %v, expected near -120dBFS (silence)", lvl.Left)
		}
	} else {
		t.Error("m2 did not receive level")
	}
}

func TestASIO_FanOutCb_InstalledWhenStreaming(t *testing.T) {
	h, fac := hubWithMock("asio:{test-clsid}")

	_ = h.Subscribe("monitor", 1, 2, 48000, Callbacks{})
	mc := fac.getLast()

	// Monitor-only: multiLevelCb should be installed, not fanOut.
	mc.mu.Lock()
	hasML := mc.multiLevelCb != nil
	hasFO := mc.pcmFanOutCb != nil
	mc.mu.Unlock()
	if !hasML {
		t.Error("multiLevelCb should be installed for monitor-only")
	}
	if hasFO {
		t.Error("pcmFanOutCb should NOT be installed for monitor-only")
	}

	// Add a streaming subscriber — fan-out should be installed.
	_ = h.StartStream("stream1", 1, 2, 48000, StreamConfig{
		IngestURL:  "http://dummy",
		IngestFunc: func(ctx context.Context, url, ct string, r io.Reader) error { return nil },
	}, Callbacks{})

	mc.mu.Lock()
	hasML = mc.multiLevelCb != nil
	hasFO = mc.pcmFanOutCb != nil
	mc.mu.Unlock()
	if hasML {
		t.Error("multiLevelCb should be nil when streaming")
	}
	if !hasFO {
		t.Error("pcmFanOutCb should be installed when streaming")
	}
}

func TestWASAPI_Positions_SetOnSubscribe(t *testing.T) {
	h, _ := hubWithMock("wasapi:test")

	_ = h.Subscribe("m1", 3, 4, 48000, Callbacks{})

	h.mu.Lock()
	sub := h.subs["m1"]
	h.mu.Unlock()

	// chL=3→0-based=2, chR=4→0-based=3; posL/posR set directly
	if sub.posL != 2 || sub.posR != 3 {
		t.Errorf("posL=%d posR=%d, want posL=2 posR=3", sub.posL, sub.posR)
	}
}

func TestStopMonitors_LeavesStreamsRunning(t *testing.T) {
	h, fac := hubWithMock("wasapi:test")

	_ = h.Subscribe("monitor", 1, 2, 48000, Callbacks{})
	_ = h.StartStream("stream1", 1, 2, 48000, StreamConfig{
		IngestURL:  "http://dummy",
		IngestFunc: func(ctx context.Context, url, ct string, r io.Reader) error {
			<-ctx.Done()
			return nil
		},
	}, Callbacks{})
	mc := fac.getLast()

	h.StopMonitors()

	h.mu.Lock()
	_, hasMonitor := h.subs["monitor"]
	_, hasStream := h.subs["stream1"]
	capStillSet := h.cap == mc
	h.mu.Unlock()

	if hasMonitor {
		t.Error("monitor should have been removed")
	}
	if !hasStream {
		t.Error("stream should still be registered")
	}
	if !capStillSet {
		t.Error("capturer should still be running")
	}
}

func TestRecovery_RestartsAfterUnexpectedStop(t *testing.T) {
	h, fac := hubWithMock("wasapi:test")

	_ = h.Subscribe("m1", 1, 2, 48000, Callbacks{})
	first := fac.getLast()
	if first == nil {
		t.Fatal("first capturer not created")
	}

	// Simulate unexpected crash: close doneCh without cancelling capCtx.
	first.simulateCrash()

	// Hub's watchCapturer sleeps 3s then restarts. We need a faster timeout for tests.
	// Skip the real 3s wait — just verify the restart path is triggered.
	// Instead use a poll with generous timeout.
	deadline := time.Now().Add(5 * time.Second)
	var second *mockCapturer
	for time.Now().Before(deadline) {
		second = fac.getLast()
		if second != nil && second != first {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if second == nil || second == first {
		t.Error("capturer was not restarted after unexpected stop")
	}
}
