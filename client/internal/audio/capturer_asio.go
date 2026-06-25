//go:build windows && asio

package audio

/*
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

type ASIOCapturer struct {
	cfg            CaptureConfig
	actualChannels int
	openChs        []int // 0-based channels passed to asio_start_capture (sorted)
	pcmOut         chan []byte
	levels         chan LevelUpdate
	stopCh         chan struct{}
	doneCh         chan struct{}
	callbackOnce   sync.Once
	callbackFired  atomic.Bool
	lastLevelAt    time.Time
	multiLevelCb   func(int, []int16)
	multiLevelMu   sync.RWMutex
	pcmFanOutCb    func([]byte)
	pcmFanOutMu    sync.RWMutex
	hasFanOut      atomic.Bool
}

func (c *ASIOCapturer) SetMultiLevelCallback(cb func(frames int, pcm []int16)) {
	c.multiLevelMu.Lock()
	c.multiLevelCb = cb
	c.multiLevelMu.Unlock()
}

func (c *ASIOCapturer) SetPCMFanOutCallback(cb func([]byte)) {
	c.pcmFanOutMu.Lock()
	c.pcmFanOutCb = cb
	c.hasFanOut.Store(cb != nil)
	c.pcmFanOutMu.Unlock()
}

// NewCapturer returns an ASIOCapturer for "asio:" devices, WasapiCapturer otherwise.
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
func (c *ASIOCapturer) Done() <-chan struct{}        { return c.doneCh }

func (c *ASIOCapturer) ActualConfig() CaptureConfig {
	return CaptureConfig{
		DeviceID:       c.cfg.DeviceID,
		SampleRate:     c.cfg.SampleRate,
		ChannelLeft:    c.cfg.ChannelLeft,
		ChannelRight:   c.cfg.ChannelRight,
		BitDepth:       16,
		NativeChannels: len(c.openChs),
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
			close(c.levels)
			close(c.pcmOut)
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
		asioChannelCache.Store(clsidStr, int(numInputCh))

		if int(numInputCh) < 1 {
			errCh <- fmt.Errorf("ASIO-Treiber hat keine Eingangskanäle")
			return
		}

		prefBuf := C.asio_get_preferred_buffer_size()

		var channels []C.int
		if len(c.cfg.Channels) > 0 {
			channels = make([]C.int, len(c.cfg.Channels))
			for i, ch := range c.cfg.Channels {
				if ch >= int(numInputCh) {
					ch = int(numInputCh) - 1
				}
				channels[i] = C.int(ch)
			}
			c.openChs = make([]int, len(c.cfg.Channels))
			copy(c.openChs, c.cfg.Channels)
			c.actualChannels = len(channels)
		} else {
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
			if chLIdx == chRIdx {
				channels = []C.int{C.int(chLIdx)}
				c.openChs = []int{chLIdx}
			} else {
				channels = []C.int{C.int(chLIdx), C.int(chRIdx)}
				c.openChs = []int{chLIdx, chRIdx}
			}
		}

		globalASIOCapturer.Store(c)

		sr := C.double(c.cfg.SampleRate)
		t2 := time.Now()
		if C.asio_start_capture(&channels[0], C.int(len(channels)), prefBuf, sr, &errBuf[0], 256) != 0 {
			globalASIOCapturer.Store(nil)
			errCh <- fmt.Errorf("ASIO-Aufnahme konnte nicht gestartet werden: %s", C.GoString(&errBuf[0]))
			return
		}
		log.Printf("[asio] start_capture: %v", time.Since(t2).Round(time.Millisecond))
		log.Printf("[asio] Capture gestartet: channels=%v bufSz=%d sr=%.0f (gesamt: %v)",
			c.openChs, int(prefBuf), float64(sr), time.Since(t0).Round(time.Millisecond))
		close(errCh)

		go func() {
			select {
			case <-ctx.Done():
			case <-c.stopCh:
			}
			C.asio_stop()
		}()

		go func() {
			timer := time.NewTimer(5 * time.Second)
			defer timer.Stop()
			select {
			case <-c.doneCh:
				return
			case <-timer.C:
				if !c.callbackFired.Load() {
					log.Printf("[asio] Keine Callbacks nach 5s — Treiber inaktiv, stoppe für Neustart")
					C.asio_stop() // message pump exits → defer fires → Hub watchCapturer restarts
				}
			}
		}()

		C.asio_run_message_pump()
		globalASIOCapturer.Store(nil)
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
	c.pcmFanOutMu.RLock()
	fanOut := c.pcmFanOutCb
	c.pcmFanOutMu.RUnlock()
	if fanOut != nil {
		fanOut(buf)
	} else {
		select {
		case c.pcmOut <- buf:
		default:
		}
	}
}

func (c *ASIOCapturer) sendLevels(pcm []byte) {
	if len(pcm) < 2 {
		return
	}
	now := time.Now()
	if now.Sub(c.lastLevelAt) < 33*time.Millisecond {
		return
	}
	c.lastLevelAt = now
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

func (c *ASIOCapturer) computeLevelFromC(data unsafe.Pointer, frames, nCh int, now time.Time) {
	c.lastLevelAt = now
	pcm := unsafe.Slice((*byte)(data), frames*nCh*2)
	var peakL, peakR float64
	stride := nCh * 2
	for i := 0; i+1 < len(pcm); i += stride {
		sL := math.Abs(float64(int16(uint16(pcm[i])|uint16(pcm[i+1])<<8)) / 32768.0)
		if sL > peakL {
			peakL = sL
		}
		if nCh >= 2 && i+3 < len(pcm) {
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
