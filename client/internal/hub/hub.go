//go:build windows

package hub

import (
	"context"
	"fmt"
	"io"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"client/internal/audio"
)

// StreamConfig holds encoding + ingest parameters for a streaming subscriber.
type StreamConfig struct {
	IngestURL  string
	Format     audio.Format
	Bitrate    int
	SampleRate uint32
	// IngestFunc is the transport used to deliver encoded audio.
	// Typically wsclient.PutIngest; injectable for testing.
	IngestFunc func(ctx context.Context, url, contentType string, body io.Reader) error
}

// Callbacks are the event hooks a subscriber provides to the Hub.
type Callbacks struct {
	OnLevel  func(audio.LevelUpdate)
	OnStatus func(running, connected bool, bytesSent int64, uptime time.Duration)
	OnError  func(msg string)
}

type subscriber struct {
	id         string
	chL, chR   int // 0-based requested channels
	posL, posR int // position within the capturer's opened channel array
	cbs        Callbacks
	sampleRate uint32

	// non-nil only for streaming subscribers
	streamCfg    *StreamConfig
	pcmCh        chan []byte
	encoder      *audio.Encoder
	streamCtx    context.Context
	streamCancel context.CancelFunc
	streamDone   chan struct{}
	startedAt    time.Time
}

// Hub manages one audio device: one capturer shared by all subscribers.
// Monitors receive VU-level updates; streams additionally encode and ingest.
type Hub struct {
	deviceID string
	isASIO   bool

	mu        sync.Mutex
	subs      map[string]*subscriber
	cap       audio.Capturer
	capCtx    context.Context    // cancelled on intentional stop
	capCancel context.CancelFunc
	capChs    []int // ASIO: channels the current capturer is opened with
	openChs   []int // ASIO: desired union of all subscriber channels
	nativeCh  int   // actual interleaved channel count in the PCM buffer

	startMu sync.Mutex // serializes capturer start/restart

	// Injectable for tests; defaults to audio.NewCapturer.
	newCap func(audio.CaptureConfig) audio.Capturer
}

func newHub(deviceID string) *Hub {
	return &Hub{
		deviceID: deviceID,
		isASIO:   strings.HasPrefix(deviceID, "asio:"),
		subs:     make(map[string]*subscriber),
		newCap:   audio.NewCapturer,
	}
}

// Subscribe adds a monitor-only subscriber (level display, no encoding).
func (h *Hub) Subscribe(id string, chL, chR uint16, sampleRate uint32, cbs Callbacks) error {
	chL0, chR0 := clamp0(chL), clamp0(chR)
	sub := &subscriber{id: id, chL: chL0, chR: chR0, cbs: cbs, sampleRate: sampleRate}
	return h.addSub(sub)
}

// StartStream adds a streaming subscriber (level + encoding + Icecast ingest).
func (h *Hub) StartStream(id string, chL, chR uint16, sampleRate uint32, scfg StreamConfig, cbs Callbacks) error {
	chL0, chR0 := clamp0(chL), clamp0(chR)
	ctx, cancel := context.WithCancel(context.Background())
	sub := &subscriber{
		id: id, chL: chL0, chR: chR0, cbs: cbs, sampleRate: sampleRate,
		streamCfg: &scfg, pcmCh: make(chan []byte, 32),
		streamCtx: ctx, streamCancel: cancel,
		streamDone: make(chan struct{}),
		startedAt:  time.Now(),
	}
	if err := h.addSub(sub); err != nil {
		cancel()
		return err
	}
	return nil
}

// Unsubscribe removes a subscriber and stops its stream if active.
// The capturer is stopped when the last subscriber leaves.
func (h *Hub) Unsubscribe(id string) {
	h.mu.Lock()
	sub, ok := h.subs[id]
	if !ok {
		h.mu.Unlock()
		return
	}
	delete(h.subs, id)
	if h.isASIO {
		h.openChs = h.computeUnion()
		h.recomputePositions(h.openChs)
	}
	empty := len(h.subs) == 0
	cap := h.cap
	log.Printf("[hub/%s] sub- id=%s (remaining=%d)", h.deviceID, id, len(h.subs))
	h.mu.Unlock()

	if sub.streamCancel != nil {
		sub.streamCancel()
	}
	if sub.encoder != nil {
		sub.encoder.Close()
	}

	if empty {
		h.stopCapturer()
	} else if cap != nil {
		h.reinstallCapturerCallbacks(cap)
	}
}

// StopMonitors stops all monitor-only subscribers, leaves streams running.
func (h *Hub) StopMonitors() {
	h.mu.Lock()
	toStop := make([]string, 0)
	for id, s := range h.subs {
		if s.streamCfg == nil {
			delete(h.subs, id)
			toStop = append(toStop, id)
		}
	}
	if h.isASIO && len(toStop) > 0 {
		h.openChs = h.computeUnion()
		h.recomputePositions(h.openChs)
	}
	empty := len(h.subs) == 0
	cap := h.cap
	h.mu.Unlock()

	if empty {
		h.stopCapturer()
	} else if cap != nil && len(toStop) > 0 {
		h.reinstallCapturerCallbacks(cap)
	}
}

// StopAll stops every subscriber and the capturer.
func (h *Hub) StopAll() {
	h.mu.Lock()
	subs := make([]*subscriber, 0, len(h.subs))
	for _, s := range h.subs {
		subs = append(subs, s)
	}
	h.subs = make(map[string]*subscriber)
	h.openChs = nil
	h.mu.Unlock()

	for _, s := range subs {
		if s.streamCancel != nil {
			s.streamCancel()
		}
		if s.encoder != nil {
			s.encoder.Close()
		}
	}
	h.stopCapturer()
}

// StopCapturer stops the capturer without removing subscribers.
// Call before opening the ASIO control panel so the driver can be accessed.
func (h *Hub) StopCapturer() {
	h.stopCapturer()
}

// ReopenCapturer stops and restarts the capturer with the current subscriber set.
// Used after the ASIO control panel closes to pick up changed channel counts.
func (h *Hub) ReopenCapturer() {
	h.startMu.Lock()
	defer h.startMu.Unlock()

	h.mu.Lock()
	if len(h.subs) == 0 {
		h.mu.Unlock()
		return
	}
	chs := h.openChs
	var sr uint32
	for _, s := range h.subs {
		sr = s.sampleRate
		break
	}
	h.mu.Unlock()

	h.stopCapturerUnsafe()
	if err := h.startCapturer(chs, sr); err != nil {
		log.Printf("[hub/%s] ReopenCapturer fehlgeschlagen: %v", h.deviceID, err)
	}
}

// --- internal ---

func (h *Hub) addSub(sub *subscriber) error {
	// Phase 1: register subscriber (concurrent, fast).
	h.mu.Lock()
	h.subs[sub.id] = sub
	if h.isASIO {
		h.openChs = h.computeUnion()
		h.recomputePositions(h.openChs)
	} else {
		// WASAPI: positions are 0-based channel indices directly.
		sub.posL = sub.chL
		sub.posR = sub.chR
	}
	isStream := sub.streamCfg != nil
	log.Printf("[hub/%s] sub+ id=%s chL=%d chR=%d posL=%d posR=%d stream=%v total=%d",
		h.deviceID, sub.id, sub.chL, sub.chR, sub.posL, sub.posR, isStream, len(h.subs))
	h.mu.Unlock()

	// Phase 2: ensure capturer (serialized).
	h.startMu.Lock()
	defer h.startMu.Unlock()

	h.mu.Lock()
	currentCap := h.cap
	currentOpenChs := h.openChs
	currentCapChs := h.capChs
	var sr uint32
	for _, s := range h.subs {
		sr = s.sampleRate
		break
	}
	if sub.sampleRate > 0 {
		sr = sub.sampleRate
	}
	h.mu.Unlock()

	if currentCap == nil {
		return h.startCapturer(currentOpenChs, sr)
	}
	if h.isASIO && !slicesEqual(currentCapChs, currentOpenChs) {
		log.Printf("[hub/%s] Kanal-Union erweitert: %v → %v — Capturer wird neu gestartet",
			h.deviceID, currentCapChs, currentOpenChs)
		h.stopCapturerUnsafe()
		return h.startCapturer(currentOpenChs, sr)
	}
	h.reinstallCapturerCallbacks(currentCap)
	h.launchStreamSub(sub, currentCap.ActualConfig().SampleRate)
	return nil
}

func (h *Hub) startCapturer(chs []int, sampleRate uint32) error {
	cfg := audio.CaptureConfig{
		DeviceID:   h.deviceID,
		SampleRate: sampleRate,
		BitDepth:   16,
	}
	if h.isASIO {
		cfg.Channels = chs
	} else {
		h.mu.Lock()
		for _, s := range h.subs {
			cfg.ChannelLeft = uint16(s.chL + 1)
			cfg.ChannelRight = uint16(s.chR + 1)
			break
		}
		h.mu.Unlock()
	}

	cap := h.newCap(cfg)
	capCtx, capCancel := context.WithCancel(context.Background())
	if err := cap.Start(capCtx); err != nil {
		capCancel()
		return err
	}

	actual := cap.ActualConfig()
	actualSR := actual.SampleRate
	if actualSR == 0 {
		actualSR = sampleRate
	}

	h.mu.Lock()
	h.cap = cap
	h.capCtx = capCtx
	h.capCancel = capCancel
	if h.isASIO {
		h.capChs = chs
		h.nativeCh = len(chs)
	} else {
		h.nativeCh = actual.NativeChannels
	}
	h.mu.Unlock()

	log.Printf("[hub/%s] Capturer gestartet: channels=%v nativeCh=%d sr=%d",
		h.deviceID, chs, h.nativeCh, actualSR)

	if !h.isASIO {
		go h.runLevelDispatch(cap)
	}

	h.reinstallCapturerCallbacks(cap)

	h.mu.Lock()
	streamSubs := make([]*subscriber, 0)
	for _, s := range h.subs {
		if s.streamCfg != nil && s.encoder == nil {
			streamSubs = append(streamSubs, s)
		}
	}
	h.mu.Unlock()
	for _, s := range streamSubs {
		h.launchStreamSub(s, actualSR)
	}

	// Watch for unexpected stops and auto-restart.
	go h.watchCapturer(cap, capCtx, chs, actualSR)

	return nil
}

// watchCapturer monitors a capturer and restarts it if it stops unexpectedly.
func (h *Hub) watchCapturer(cap audio.Capturer, capCtx context.Context, chs []int, sr uint32) {
	<-cap.Done()

	// Intentional stop: capCtx was cancelled before Done fired.
	if capCtx.Err() != nil {
		return
	}

	// Verify this capturer is still active in the Hub.
	h.mu.Lock()
	isCurrent := h.cap == cap
	hasSubs := len(h.subs) > 0
	if isCurrent {
		h.cap = nil
		cancel := h.capCancel
		h.capCancel = nil
		h.capCtx = nil
		h.capChs = nil
		h.mu.Unlock()
		if cancel != nil {
			cancel()
		}
	} else {
		h.mu.Unlock()
		return
	}

	if !hasSubs {
		return
	}

	log.Printf("[hub/%s] Capturer unerwartet gestoppt — Neustart in 3s...", h.deviceID)
	time.Sleep(3 * time.Second)

	h.startMu.Lock()
	defer h.startMu.Unlock()

	h.mu.Lock()
	hasSubs = len(h.subs) > 0
	if h.isASIO && len(h.openChs) > 0 {
		chs = h.openChs // use updated union in case subscribers changed during sleep
	}
	h.mu.Unlock()

	if !hasSubs {
		return
	}

	if err := h.startCapturer(chs, sr); err != nil {
		log.Printf("[hub/%s] Neustart fehlgeschlagen: %v", h.deviceID, err)
		h.mu.Lock()
		for _, s := range h.subs {
			if s.cbs.OnError != nil {
				go s.cbs.OnError(fmt.Sprintf("Audio-Neustart fehlgeschlagen: %v", err))
			}
		}
		h.mu.Unlock()
	}
}

func (h *Hub) stopCapturer() {
	h.startMu.Lock()
	defer h.startMu.Unlock()
	h.stopCapturerUnsafe()
}

func (h *Hub) stopCapturerUnsafe() {
	h.mu.Lock()
	cap := h.cap
	cancel := h.capCancel
	h.cap = nil
	h.capCancel = nil
	h.capCtx = nil
	h.capChs = nil
	h.mu.Unlock()

	if cancel != nil {
		cancel() // signal watchCapturer that this is intentional
	}
	if cap != nil {
		cap.Stop()
	}
}

func (h *Hub) reinstallCapturerCallbacks(cap audio.Capturer) {
	if h.isASIO {
		h.reinstallASIOCallbacks(cap)
	} else {
		h.reinstallWASAPICallbacks(cap)
	}
}

func (h *Hub) reinstallASIOCallbacks(cap audio.Capturer) {
	h.mu.Lock()
	hasStream := false
	streamCount, monitorCount := 0, 0
	for _, s := range h.subs {
		if s.streamCfg != nil {
			hasStream = true
			streamCount++
		} else {
			monitorCount++
		}
	}
	h.mu.Unlock()

	if hasStream {
		log.Printf("[hub/%s] ASIO callbacks: fanOut (stream=%d monitor=%d)", h.deviceID, streamCount, monitorCount)
		if pfc, ok := cap.(audio.PCMFanOutCapturer); ok {
			pfc.SetPCMFanOutCallback(h.buildFanOutCb())
		}
		if mlc, ok := cap.(audio.MultiLevelCapturer); ok {
			mlc.SetMultiLevelCallback(nil)
		}
	} else {
		log.Printf("[hub/%s] ASIO callbacks: multiLevel (monitor=%d)", h.deviceID, monitorCount)
		if mlc, ok := cap.(audio.MultiLevelCapturer); ok {
			mlc.SetMultiLevelCallback(h.buildMultiLevelCb())
		}
		if pfc, ok := cap.(audio.PCMFanOutCapturer); ok {
			pfc.SetPCMFanOutCallback(nil)
		}
	}
}

// reinstallWASAPICallbacks installs a PCM fan-out callback when streaming
// subscribers are present so each gets its own channel-pair extraction.
// Monitor-only mode uses LevelCh() dispatched by runLevelDispatch.
func (h *Hub) reinstallWASAPICallbacks(cap audio.Capturer) {
	pfc, ok := cap.(audio.PCMFanOutCapturer)
	if !ok {
		return
	}
	h.mu.Lock()
	hasStream := false
	streamCount, monitorCount := 0, 0
	for _, s := range h.subs {
		if s.streamCfg != nil {
			hasStream = true
			streamCount++
		} else {
			monitorCount++
		}
	}
	h.mu.Unlock()

	if hasStream {
		log.Printf("[hub/%s] WASAPI callbacks: fanOut (stream=%d monitor=%d)", h.deviceID, streamCount, monitorCount)
		pfc.SetPCMFanOutCallback(h.buildFanOutCb())
	} else {
		log.Printf("[hub/%s] WASAPI callbacks: levelCh (monitor=%d)", h.deviceID, monitorCount)
		pfc.SetPCMFanOutCallback(nil)
	}
}

// buildFanOutCb returns a PCM fan-out callback for streaming mode (ASIO + WASAPI).
// It extracts per-subscriber stereo PCM and dispatches throttled VU levels.
func (h *Hub) buildFanOutCb() func([]byte) {
	var lastLvlAt time.Time
	return func(buf []byte) {
		h.mu.Lock()
		type entry struct {
			posL, posR int
			pcmCh      chan []byte
			lvlCb      func(audio.LevelUpdate)
		}
		entries := make([]entry, 0, len(h.subs))
		for _, s := range h.subs {
			entries = append(entries, entry{s.posL, s.posR, s.pcmCh, s.cbs.OnLevel})
		}
		numCh := h.nativeCh
		h.mu.Unlock()

		now := time.Now()
		sendLvl := now.Sub(lastLvlAt) >= 33*time.Millisecond
		if sendLvl {
			lastLvlAt = now
		}

		for _, e := range entries {
			stereo := audio.ExtractStereoBytes(buf, numCh, e.posL, e.posR)
			if e.pcmCh != nil && len(stereo) > 0 {
				select {
				case e.pcmCh <- stereo:
				default:
				}
			}
			if sendLvl && len(stereo) >= 4 && e.lvlCb != nil {
				e.lvlCb(audio.LevelFromStereoBytes(stereo))
			}
		}
	}
}

// buildMultiLevelCb returns an ASIO multi-level callback for monitor-only mode (zero-alloc).
func (h *Hub) buildMultiLevelCb() func(int, []int16) {
	return func(frames int, pcm []int16) {
		h.mu.Lock()
		type entry struct {
			posL, posR int
			lvlCb      func(audio.LevelUpdate)
		}
		entries := make([]entry, 0, len(h.subs))
		for _, s := range h.subs {
			if s.cbs.OnLevel != nil {
				entries = append(entries, entry{s.posL, s.posR, s.cbs.OnLevel})
			}
		}
		numCh := h.nativeCh
		h.mu.Unlock()

		for _, e := range entries {
			e.lvlCb(audio.ExtractChannelLevel(pcm, frames, numCh, e.posL, e.posR))
		}
	}
}

// runLevelDispatch reads LevelCh and fans levels to all subscribers (WASAPI monitor mode).
func (h *Hub) runLevelDispatch(cap audio.Capturer) {
	for lvl := range cap.LevelCh() {
		h.mu.Lock()
		cbs := make([]func(audio.LevelUpdate), 0, len(h.subs))
		for _, s := range h.subs {
			if s.cbs.OnLevel != nil {
				cbs = append(cbs, s.cbs.OnLevel)
			}
		}
		h.mu.Unlock()
		for _, cb := range cbs {
			cb(lvl)
		}
	}
}

// launchStreamSub creates the encoder and starts audio/ingest goroutines for a streaming subscriber.
func (h *Hub) launchStreamSub(s *subscriber, actualSR uint32) {
	if s.streamCfg == nil {
		return
	}
	if actualSR == 0 {
		actualSR = s.sampleRate
	}
	enc, err := audio.NewEncoder(audio.EncoderConfig{
		Format:          s.streamCfg.Format,
		Bitrate:         s.streamCfg.Bitrate,
		SampleRate:      s.streamCfg.SampleRate,
		Channels:        2,
		InputSampleRate: actualSR,
		InputChannels:   2,
	})
	if err != nil {
		log.Printf("[hub/%s] Encoder-Fehler für %s: %v", h.deviceID, s.id, err)
		if s.cbs.OnError != nil {
			s.cbs.OnError(err.Error())
		}
		return
	}

	h.mu.Lock()
	s.encoder = enc
	h.mu.Unlock()

	log.Printf("[stream/%s] Encoder gestartet: format=%s bitrate=%d inSR=%d outSR=%d",
		s.id, s.streamCfg.Format, s.streamCfg.Bitrate, actualSR, s.streamCfg.SampleRate)

	go h.pumpAudio(s)
	go h.pumpIngest(s)
}

func (h *Hub) pumpAudio(s *subscriber) {
	for {
		select {
		case <-s.streamCtx.Done():
			return
		case pcm, ok := <-s.pcmCh:
			if !ok {
				return
			}
			if s.encoder != nil {
				s.encoder.Write(pcm) //nolint:errcheck
			}
		}
	}
}

func (h *Hub) pumpIngest(s *subscriber) {
	defer close(s.streamDone)

	if s.cbs.OnStatus != nil {
		s.cbs.OnStatus(true, false, 0, 0)
	}

	ingestFn := s.streamCfg.IngestFunc
	contentType := s.streamCfg.Format.ContentType()
	ingestURL := s.streamCfg.IngestURL

	pr, pw := io.Pipe()

	go func() {
		r := s.encoder.Output()
		buf := make([]byte, 4096)
		first := true
		for {
			n, err := r.Read(buf)
			if n > 0 {
				if first {
					log.Printf("[stream/%s] erster Encoder-Output: %d Bytes", s.id, n)
					first = false
					if s.cbs.OnStatus != nil {
						s.cbs.OnStatus(true, true, 0, time.Since(s.startedAt))
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

	log.Printf("[stream/%s] Ingest → %s", s.id, ingestURL)
	err := ingestFn(s.streamCtx, ingestURL, contentType, pr)
	if err != nil && s.streamCtx.Err() == nil {
		log.Printf("[stream/%s] Ingest Fehler: %v", s.id, err)
		if s.cbs.OnError != nil {
			s.cbs.OnError(err.Error())
		}
	}
	pr.Close()

	if s.cbs.OnStatus != nil {
		s.cbs.OnStatus(false, false, 0, 0)
	}
	log.Printf("[stream/%s] Ingest beendet", s.id)
}

// --- ASIO channel helpers ---

func (h *Hub) computeUnion() []int {
	set := make(map[int]bool)
	for _, s := range h.subs {
		set[s.chL] = true
		set[s.chR] = true
	}
	chs := make([]int, 0, len(set))
	for ch := range set {
		chs = append(chs, ch)
	}
	sort.Ints(chs)
	return chs
}

func (h *Hub) recomputePositions(chs []int) {
	for _, s := range h.subs {
		s.posL = indexOf(chs, s.chL)
		s.posR = indexOf(chs, s.chR)
	}
}

func indexOf(chs []int, ch int) int {
	for i, c := range chs {
		if c == ch {
			return i
		}
	}
	return 0
}

func slicesEqual(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func clamp0(ch uint16) int {
	if ch < 1 {
		return 0
	}
	return int(ch) - 1
}
