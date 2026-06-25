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
	"log"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

// globalASIOCapturer is written in Start()/Stop() and read from the C ASIO
// callback thread; atomic access avoids a race with the Go mutex.
var globalASIOCapturer atomic.Pointer[ASIOCapturer]

var (
	// asioGlobalMu serializes all ASIO driver opens — only one at a time.
	asioGlobalMu sync.Mutex

	// asioEnumerateMu serializes calls to asioEnumerateDrivers.
	asioEnumerateMu sync.Mutex

	// asioChannelCache holds the last known channel count per CLSID.
	// Used when TryLock fails (driver busy) so re-enumeration doesn't fall back to 2ch.
	asioChannelCache sync.Map // clsid string → int

	// activePanelClsid is the CLSID currently showing its control panel.
	// Probes for that CLSID skip the C call and use the cache while the panel is open.
	activePanelClsid atomic.Value // stores string
)

//export goAsioBufferCallback
func goAsioBufferCallback(data unsafe.Pointer, numFrames C.int, _ C.int, numChannels C.int) {
	capturer := globalASIOCapturer.Load()
	if capturer == nil {
		return
	}
	capturer.callbackFired.Store(true)
	capturer.callbackOnce.Do(func() {
		log.Printf("[asio] Erster Callback: frames=%d ch=%d", int(numFrames), int(numChannels))
	})

	nCh := int(numChannels)
	frames := int(numFrames)

	now := time.Now()
	levelDue := now.Sub(capturer.lastLevelAt) >= 33*time.Millisecond
	hasPCMSpace := len(capturer.pcmOut) < cap(capturer.pcmOut) || capturer.hasFanOut.Load()
	if !levelDue && !hasPCMSpace {
		return
	}

	if hasPCMSpace {
		srcBytes := frames * nCh * 2
		var buf []byte
		if nCh == 1 {
			buf = make([]byte, frames*4)
			src := unsafe.Slice((*byte)(data), srcBytes)
			for i := range frames {
				buf[i*4+0] = src[i*2+0]
				buf[i*4+1] = src[i*2+1]
				buf[i*4+2] = src[i*2+0]
				buf[i*4+3] = src[i*2+1]
			}
		} else {
			buf = make([]byte, srcBytes)
			copy(buf, unsafe.Slice((*byte)(data), srcBytes))
		}
		capturer.sendPCM(buf)
	} else {
		capturer.multiLevelMu.RLock()
		mlCb := capturer.multiLevelCb
		capturer.multiLevelMu.RUnlock()
		if mlCb != nil {
			capturer.lastLevelAt = now
			pcm := unsafe.Slice((*int16)(data), frames*nCh)
			mlCb(frames, pcm)
		} else {
			capturer.computeLevelFromC(data, frames, nCh, now)
		}
	}
}

// OpenASIOControlPanel opens the driver's settings panel in a background thread.
func OpenASIOControlPanel(clsid string) {
	cClsid := C.CString(clsid)
	defer C.free(unsafe.Pointer(cClsid))
	C.asio_open_control_panel(cClsid)
}

// OpenASIOControlPanelSync opens the panel and blocks until the user closes it.
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

func asioProbeDriver(clsid string) (channels int, sampleRate float64) {
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
	log.Printf("[asio] probe OK: %s → ch=%d sr=%.0f", clsid, ch, rate)
	return ch, rate
}

func asioProbeDriverSTA(clsid string) (channels int, sampleRate float64) {
	type result struct {
		ch int
		sr float64
	}
	res := make(chan result, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		ch, sr := asioProbeDriver(clsid)
		res <- result{ch, sr}
	}()
	r := <-res
	return r.ch, r.sr
}
