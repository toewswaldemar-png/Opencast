//go:build windows && asio

package audio

/*
#cgo CXXFLAGS: -I../../../ASIOSDK/common
#cgo LDFLAGS: -lole32 -loleaut32 -ladvapi32 -lws2_32 -lstdc++
#include "asio_host.h"
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"fmt"
	"log"
	"math"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

)

var (
	globalASIOCapturerMu sync.Mutex
	globalASIOCapturer   *ASIOCapturer

	// asioGlobalMu serializes all ASIO driver opens — only one at a time.
	// asio_open_driver writes the global g_asio; a concurrent second open
	// would free the first's driver while it is still in asio_run_message_pump.
	asioGlobalMu sync.Mutex

	// asioEnumerateMu serializes calls to asioEnumerateDrivers.
	// main_windows.go starts ws.Run() and the tray-menu goroutine concurrently;
	// both call EnumerateInputDevices → asioEnumerateDrivers at the same time.
	// Without this mutex the first call holds asioGlobalMu (via probe TryLock)
	// and the concurrent second call sees all TryLocks fail → returns 32ch for all.
	asioEnumerateMu sync.Mutex

	// asioChannelCache holds the last known channel count per CLSID.
	// Used when TryLock fails (driver busy with monitor/capture) so re-enumeration
	// doesn't fall back to 2 channels for the active device.
	asioChannelCache sync.Map // clsid string → int

	// activePanelClsid is the CLSID of the ASIO driver currently showing its
	// control panel. The panel creates its own IASIO instance; a concurrent probe
	// would try to create a second instance which fails for most drivers.
	// While this is set, probes for that CLSID skip the C call and use the cache.
	activePanelClsid atomic.Value // stores string
)

//export goAsioBufferCallback
func goAsioBufferCallback(data unsafe.Pointer, numFrames C.int, _ C.int, numChannels C.int) {
	globalASIOCapturerMu.Lock()
	capturer := globalASIOCapturer
	globalASIOCapturerMu.Unlock()
	if capturer == nil {
		return
	}
	capturer.callbackFired.Store(true)
	capturer.callbackOnce.Do(func() {
		log.Printf("[asio] Erster Callback: frames=%d ch=%d", int(numFrames), int(numChannels))
	})
	nCh := int(numChannels)
	srcBytes := int(numFrames) * nCh * 2
	src := make([]byte, srcBytes)
	copy(src, unsafe.Slice((*byte)(data), srcBytes))

	var buf []byte
	if nCh == 1 {
		// L == R: one ASIO channel opened — expand to stereo so the rest of the
		// pipeline always sees 2-channel interleaved PCM.
		buf = make([]byte, int(numFrames)*4)
		for i := range int(numFrames) {
			buf[i*4+0] = src[i*2+0]
			buf[i*4+1] = src[i*2+1]
			buf[i*4+2] = src[i*2+0]
			buf[i*4+3] = src[i*2+1]
		}
	} else {
		buf = src
	}
	capturer.sendPCM(buf)
}

type ASIOCapturer struct {
	cfg            CaptureConfig
	actualChannels int
	pcmOut         chan []byte
	levels         chan LevelUpdate
	stopCh         chan struct{}
	doneCh         chan struct{}
	callbackOnce   sync.Once
	callbackFired  atomic.Bool
}

// NewCapturer dispatches to ASIOCapturer for "asio:" devices, WasapiCapturer otherwise.
func NewCapturer(cfg CaptureConfig) Capturer {
	if strings.HasPrefix(cfg.DeviceID, "asio:") {
		return &ASIOCapturer{
			cfg:    cfg,
			pcmOut: make(chan []byte, 32),
			levels: make(chan LevelUpdate, 16),
			stopCh: make(chan struct{}),
			doneCh: make(chan struct{}),
		}
	}
	return &WasapiCapturer{
		cfg:    cfg,
		pcmOut: make(chan []byte, 32),
		levels: make(chan LevelUpdate, 16),
		stopCh: make(chan struct{}),
		doneCh: make(chan struct{}),
	}
}

func (c *ASIOCapturer) OutputCh() <-chan []byte     { return c.pcmOut }
func (c *ASIOCapturer) LevelCh() <-chan LevelUpdate { return c.levels }

func (c *ASIOCapturer) ActualConfig() CaptureConfig {
	return CaptureConfig{
		DeviceID:    c.cfg.DeviceID,
		SampleRate:  c.cfg.SampleRate,
		ChannelLeft:  c.cfg.ChannelLeft,
		ChannelRight: c.cfg.ChannelRight,
		BitDepth:    16,
	}
}

func (c *ASIOCapturer) Start(ctx context.Context) error {
	clsidStr := strings.TrimPrefix(c.cfg.DeviceID, "asio:")
	errCh := make(chan error, 1)

	go func() {
		asioGlobalMu.Lock()
		runtime.LockOSThread()
		defer func() {
			C.asio_release_driver()
			asioGlobalMu.Unlock()
			close(c.doneCh)
			runtime.UnlockOSThread()
		}()

		cClsid := C.CString(clsidStr)
		defer C.free(unsafe.Pointer(cClsid))

		var errBuf [256]C.char

		t0 := time.Now()
		if C.asio_open_driver(cClsid, &errBuf[0], 256) != 0 {
			errCh <- fmt.Errorf("ASIO-Treiber konnte nicht geöffnet werden: %s", C.GoString(&errBuf[0]))
			return
		}
		log.Printf("[asio] open_driver: %v", time.Since(t0).Round(time.Millisecond))

		t1 := time.Now()
		var numInputCh C.long
		var defSR C.double
		if C.asio_get_driver_info(&numInputCh, &defSR, &errBuf[0], 256) != 0 {
			errCh <- fmt.Errorf("ASIO-Treiberinfo: %s", C.GoString(&errBuf[0]))
			return
		}
		log.Printf("[asio] get_driver_info: %v", time.Since(t1).Round(time.Millisecond))
		// Cache real channel count so re-enumeration while this driver is busy
		// (TryLock fails) still reports the correct maxInputChannels.
		asioChannelCache.Store(clsidStr, int(numInputCh))

		if int(numInputCh) < 1 {
			errCh <- fmt.Errorf("ASIO-Treiber hat keine Eingangskanäle")
			return
		}

		chL := int(c.cfg.ChannelLeft)
		if chL < 1 {
			chL = 1
		}
		chR := int(c.cfg.ChannelRight)
		if chR < 1 {
			chR = 2
		}
		chLIdx := chL - 1
		chRIdx := chR - 1
		if chLIdx >= int(numInputCh) {
			chLIdx = int(numInputCh) - 1
		}
		if chRIdx >= int(numInputCh) {
			chRIdx = int(numInputCh) - 1
		}
		c.actualChannels = 2

		prefBuf := C.asio_get_preferred_buffer_size()
		// When L == R, open only one ASIO channel to avoid passing duplicate
		// channelNum values to createBuffers — some drivers (e.g. ReaRoute)
		// fall back to sequential channels when they see duplicates.
		// The Go callback expands the single channel to 2-channel stereo PCM.
		var channels []C.int
		if chLIdx == chRIdx {
			channels = []C.int{C.int(chLIdx)}
		} else {
			channels = []C.int{C.int(chLIdx), C.int(chRIdx)}
		}

		globalASIOCapturerMu.Lock()
		globalASIOCapturer = c
		globalASIOCapturerMu.Unlock()

		sr := C.double(c.cfg.SampleRate)
		t2 := time.Now()
		if C.asio_start_capture(&channels[0], C.int(len(channels)), prefBuf, sr, &errBuf[0], 256) != 0 {
			globalASIOCapturerMu.Lock()
			globalASIOCapturer = nil
			globalASIOCapturerMu.Unlock()
			errCh <- fmt.Errorf("ASIO-Aufnahme konnte nicht gestartet werden: %s", C.GoString(&errBuf[0]))
			return
		}
		log.Printf("[asio] start_capture: %v", time.Since(t2).Round(time.Millisecond))

		log.Printf("[asio] Capture gestartet: L=%d R=%d bufSz=%d sr=%.0f (gesamt: %v)",
			chLIdx, chRIdx, int(prefBuf), float64(sr), time.Since(t0).Round(time.Millisecond))
		close(errCh)

		go func() {
			select {
			case <-ctx.Done():
			case <-c.stopCh:
			}
			C.asio_stop()
		}()

		// Watchdog: warn if no callbacks arrive within 5 s.
		// Typical cause: ASIO driver is not the primary host (e.g. ReaRoute ASIO
		// while REAPER uses a hardware device) — use WASAPI loopback instead.
		go func() {
			timer := time.NewTimer(5 * time.Second)
			defer timer.Stop()
			select {
			case <-c.doneCh:
			case <-timer.C:
				if !c.callbackFired.Load() {
					log.Printf("[asio] WARNUNG: Keine Audio-Callbacks nach 5s. "+
						"Prüfe ob der ASIO-Treiber aktiv ist. "+
						"Für ReaRoute: WASAPI-Loopback statt ASIO verwenden.")
				}
			}
		}()

		C.asio_run_message_pump()

		globalASIOCapturerMu.Lock()
		globalASIOCapturer = nil
		globalASIOCapturerMu.Unlock()
	}()

	return <-errCh
}

func (c *ASIOCapturer) Stop() {
	select {
	case <-c.stopCh:
	default:
		close(c.stopCh)
	}
	<-c.doneCh
}

func (c *ASIOCapturer) sendPCM(buf []byte) {
	c.sendLevels(buf)
	select {
	case c.pcmOut <- buf:
	default:
	}
}

func (c *ASIOCapturer) sendLevels(pcm []byte) {
	if len(pcm) < 2 {
		return
	}
	ch := c.actualChannels
	if ch < 1 {
		ch = 1
	}
	var peakL, peakR float64
	for i := 0; i+1 < len(pcm); i += 2 * ch {
		sL := math.Abs(float64(int16(uint16(pcm[i])|uint16(pcm[i+1])<<8)) / 32768.0)
		if sL > peakL {
			peakL = sL
		}
		if ch >= 2 && i+3 < len(pcm) {
			sR := math.Abs(float64(int16(uint16(pcm[i+2])|uint16(pcm[i+3])<<8)) / 32768.0)
			if sR > peakR {
				peakR = sR
			}
		} else {
			peakR = peakL
		}
	}
	toDBFS := func(v float64) float64 {
		if v < 0.000001 {
			return -120
		}
		return math.Max(-120, 20*math.Log10(v))
	}
	select {
	case c.levels <- LevelUpdate{Left: toDBFS(peakL), Right: toDBFS(peakR)}:
	default:
	}
}

// OpenASIOControlPanel opens the driver's settings panel in a background thread.
func OpenASIOControlPanel(clsid string) {
	cClsid := C.CString(clsid)
	defer C.free(unsafe.Pointer(cClsid))
	C.asio_open_control_panel(cClsid)
}

// OpenASIOControlPanelSync opens the panel and blocks until the user closes it.
// While the panel is open, probes for this CLSID use the cache (not a new
// IASIO instance) to avoid conflicts with the panel's driver instance.
// After closing, activePanelClsid is cleared and ws.SendDevices() (called by
// the caller) runs a fresh probe — which updates the cache if TryLock succeeds,
// or falls back to the still-valid cache if the monitor holds the lock.
func OpenASIOControlPanelSync(clsid string) {
	activePanelClsid.Store(clsid)
	cClsid := C.CString(clsid)
	defer C.free(unsafe.Pointer(cClsid))
	C.asio_open_control_panel_sync(cClsid)
	activePanelClsid.Store("")
	log.Printf("[asio] ASIO Panel geschlossen: %s", clsid)
}

func asioEnumerateDrivers() []Device {
	asioEnumerateMu.Lock()
	defer asioEnumerateMu.Unlock()

	const maxDrv = 32
	var info [maxDrv]C.ASIORegEntry
	count := int(C.asio_enumerate_drivers(&info[0], C.int(maxDrv)))

	devices := make([]Device, 0, count)
	for i := 0; i < count; i++ {
		name := C.GoString(&info[i].name[0])
		clsid := C.GoString(&info[i].clsid[0])
		if name == "" || clsid == "" {
			continue
		}
		log.Printf("[asio] probe Gerät %d: %q %s", i, name, clsid)
		ch, sr := asioProbeDriverSTA(clsid)
		log.Printf("[asio] Gerät %q → ch=%d", name, ch)
		devices = append(devices, Device{
			ID:                "asio:" + clsid,
			Name:              name + " (ASIO)",
			API:               APIAsio,
			State:             StateActive,
			MaxInputChannels:  ch,
			DefaultSampleRate: sr,
		})
	}
	return devices
}

// asioProbeDriver queries the real channel count and sample rate of an ASIO driver.
// Must run on a locked OS thread with COM initialized — use asioProbeDriverSTA.
func asioProbeDriver(clsid string) (channels int, sampleRate float64) {
	// If the ASIO control panel is open for this device, skip probing:
	// the panel already holds an IASIO instance; creating a second one fails
	// for most ASIO drivers. Use the cached value from before the panel opened.
	if panelClsid, _ := activePanelClsid.Load().(string); panelClsid == clsid {
		if v, ok := asioChannelCache.Load(clsid); ok {
			cached := v.(int)
			log.Printf("[asio] probe übersprungen (Panel offen): %s → Cache ch=%d", clsid, cached)
			return cached, 48000
		}
		log.Printf("[asio] probe übersprungen (Panel offen, kein Cache): %s → Fallback 32ch", clsid)
		return 32, 48000
	}

	if !asioGlobalMu.TryLock() {
		// Driver is busy (monitor/capture running). Use cached value if available.
		if v, ok := asioChannelCache.Load(clsid); ok {
			cached := v.(int)
			log.Printf("[asio] probe übersprungen (Treiber belegt): %s → Cache ch=%d", clsid, cached)
			return cached, 48000
		}
		log.Printf("[asio] probe übersprungen (Treiber belegt, kein Cache): %s → Fallback 32ch", clsid)
		return 32, 48000
	}
	defer asioGlobalMu.Unlock()

	cClsid := C.CString(clsid)
	defer C.free(unsafe.Pointer(cClsid))

	var numCh C.long
	var sr C.double
	ret := C.asio_probe_driver(cClsid, &numCh, &sr)
	if ret != 0 {
		log.Printf("[asio] probe fehlgeschlagen für %s (code=%d) — Fallback 32ch", clsid, int(ret))
		return 32, 48000
	}
	ch := int(numCh)
	if ch < 1 {
		ch = 2
	}
	rate := float64(sr)
	if rate <= 0 {
		rate = 48000
	}
	asioChannelCache.Store(clsid, ch)
	log.Printf("[asio] probe OK: %s → ch=%d sr=%.0f (im Cache gespeichert)", clsid, ch, rate)
	return ch, rate
}

// asioProbeDriverSTA runs asioProbeDriver on a dedicated OS thread with COM STA
// initialized — required because ASIO drivers are COM objects.
func asioProbeDriverSTA(clsid string) (channels int, sampleRate float64) {
	type result struct {
		ch int
		sr float64
	}
	res := make(chan result, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		// Do NOT call ole.CoInitializeEx here. The C probe handles COM init
		// itself — exactly like asio_open_driver does for the real capture.
		// Calling CoInitializeEx(COINIT_APARTMENTTHREADED) before CoCreateInstance
		// prevents many ASIO drivers (including ReaRoute) from reporting their
		// actual channel count.
		ch, sr := asioProbeDriver(clsid)
		res <- result{ch, sr}
	}()
	r := <-res
	return r.ch, r.sr
}
