//go:build windows && asio

package audio

/*
#cgo CXXFLAGS: -I../../../ASIOSDK/common
#cgo LDFLAGS: -lole32 -loleaut32 -ladvapi32 -lstdc++
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
	byteCount := int(numFrames) * int(numChannels) * 2
	buf := make([]byte, byteCount)
	copy(buf, unsafe.Slice((*byte)(data), byteCount))
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
	ch := uint16(c.actualChannels)
	if ch == 0 {
		ch = c.cfg.Channels
	}
	return CaptureConfig{
		DeviceID:   c.cfg.DeviceID,
		SampleRate: c.cfg.SampleRate,
		Channels:   ch,
		BitDepth:   16,
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

		numCh := int(c.cfg.Channels)
		if numCh > int(numInputCh) {
			numCh = int(numInputCh)
		}
		if numCh < 1 {
			errCh <- fmt.Errorf("ASIO-Treiber hat keine Eingangskanäle")
			return
		}
		c.actualChannels = numCh

		prefBuf := C.asio_get_preferred_buffer_size()
		channels := make([]C.int, numCh)
		for i := range channels {
			channels[i] = C.int(i)
		}

		globalASIOCapturerMu.Lock()
		globalASIOCapturer = c
		globalASIOCapturerMu.Unlock()

		sr := C.double(c.cfg.SampleRate)
		t2 := time.Now()
		if C.asio_start_capture(&channels[0], C.int(numCh), prefBuf, sr, &errBuf[0], 256) != 0 {
			globalASIOCapturerMu.Lock()
			globalASIOCapturer = nil
			globalASIOCapturerMu.Unlock()
			errCh <- fmt.Errorf("ASIO-Aufnahme konnte nicht gestartet werden: %s", C.GoString(&errBuf[0]))
			return
		}
		log.Printf("[asio] start_capture: %v", time.Since(t2).Round(time.Millisecond))

		log.Printf("[asio] Capture gestartet: ch=%d bufSz=%d sr=%.0f (gesamt: %v)",
			numCh, int(prefBuf), float64(sr), time.Since(t0).Round(time.Millisecond))
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

func asioEnumerateDrivers() []Device {
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
		// No COM probe here — opening an ASIO driver without a locked OS thread
		// can crash the process. Use conservative defaults; actual values are
		// determined when capture starts on the dedicated STA goroutine.
		devices = append(devices, Device{
			ID:                "asio:" + clsid,
			Name:              name + " (ASIO)",
			API:               APIAsio,
			State:             StateActive,
			MaxInputChannels:  2,
			DefaultSampleRate: 48000,
		})
	}
	return devices
}

func asioProbeDriver(clsid string) (channels int, sampleRate float64) {
	// Non-blocking: if a stream is active (holds asioGlobalMu), return defaults
	// immediately instead of stalling the WS reconnect goroutine.
	if !asioGlobalMu.TryLock() {
		return 2, 48000
	}
	defer asioGlobalMu.Unlock()

	cClsid := C.CString(clsid)
	defer C.free(unsafe.Pointer(cClsid))

	var numCh C.long
	var sr C.double
	if C.asio_probe_driver(cClsid, &numCh, &sr) != 0 {
		return 2, 48000
	}
	ch := int(numCh)
	if ch < 1 {
		ch = 2
	}
	rate := float64(sr)
	if rate <= 0 {
		rate = 48000
	}
	return ch, rate
}
