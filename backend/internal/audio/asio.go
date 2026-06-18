//go:build windows && asio

package audio

/*
#cgo LDFLAGS: -lole32 -loleaut32 -ladvapi32
#include "asio_host.h"
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"fmt"
	"math"
	"runtime"
	"strings"
	"sync"
	"unsafe"
)

/* ------------------------------------------------------------------ */
/* Global callback bridge (ASIO only supports one driver at a time)   */
/* ------------------------------------------------------------------ */

var (
	globalASIOCapturerMu sync.Mutex
	globalASIOCapturer   *ASIOCapturer
)

//export goAsioBufferCallback
func goAsioBufferCallback(data unsafe.Pointer, numFrames C.int, _ C.int, numChannels C.int) {
	globalASIOCapturerMu.Lock()
	capturer := globalASIOCapturer
	globalASIOCapturerMu.Unlock()
	if capturer == nil {
		return
	}
	byteCount := int(numFrames) * int(numChannels) * 2 // s16le
	buf := make([]byte, byteCount)
	copy(buf, unsafe.Slice((*byte)(data), byteCount))
	capturer.sendPCM(buf)
}

/* ------------------------------------------------------------------ */
/* ASIOCapturer                                                        */
/* ------------------------------------------------------------------ */

type ASIOCapturer struct {
	cfg            CaptureConfig
	actualChannels int
	pcmOut         chan []byte
	levels         chan LevelUpdate
	stopCh         chan struct{}
	doneCh         chan struct{}
}

func (c *ASIOCapturer) OutputCh() <-chan []byte     { return c.pcmOut }
func (c *ASIOCapturer) LevelCh() <-chan LevelUpdate { return c.levels }

func (c *ASIOCapturer) Start(ctx context.Context) error {
	clsidStr := strings.TrimPrefix(c.cfg.DeviceID, "asio:")
	errCh := make(chan error, 1)

	go func() {
		runtime.LockOSThread()

		cClsid := C.CString(clsidStr)
		defer C.free(unsafe.Pointer(cClsid))

		var errBuf [256]C.char

		if C.asio_open_driver(cClsid, &errBuf[0], 256) != 0 {
			errCh <- fmt.Errorf("ASIO-Treiber konnte nicht geöffnet werden: %s", C.GoString(&errBuf[0]))
			close(c.doneCh)
			runtime.UnlockOSThread()
			return
		}

		var numInputCh C.long
		var defSR C.double
		if C.asio_get_driver_info(&numInputCh, &defSR, &errBuf[0], 256) != 0 {
			C.asio_release_driver()
			errCh <- fmt.Errorf("ASIO-Treiberinfo: %s", C.GoString(&errBuf[0]))
			close(c.doneCh)
			runtime.UnlockOSThread()
			return
		}

		numCh := int(c.cfg.Channels)
		if numCh > int(numInputCh) {
			numCh = int(numInputCh)
		}
		if numCh < 1 {
			C.asio_release_driver()
			errCh <- fmt.Errorf("ASIO-Treiber hat keine Eingangskanäle")
			close(c.doneCh)
			runtime.UnlockOSThread()
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
		if C.asio_start_capture(&channels[0], C.int(numCh), prefBuf, sr, &errBuf[0], 256) != 0 {
			globalASIOCapturerMu.Lock()
			globalASIOCapturer = nil
			globalASIOCapturerMu.Unlock()
			C.asio_release_driver()
			errCh <- fmt.Errorf("ASIO-Aufnahme konnte nicht gestartet werden: %s", C.GoString(&errBuf[0]))
			close(c.doneCh)
			runtime.UnlockOSThread()
			return
		}

		close(errCh)

		// A separate goroutine watches for the Go-side stop signal and
		// signals the C message pump via asio_stop(). This keeps the
		// locked OS thread free to run the pump (it cannot block on a
		// Go channel while also processing Windows messages).
		go func() {
			select {
			case <-ctx.Done():
			case <-c.stopCh:
			}
			C.asio_stop()
		}()

		// Block here with a proper STA message pump. The pump calls
		// stop()/disposeBuffers() internally after receiving the stop
		// signal, ensuring COM cross-apartment messages are delivered
		// before the driver is torn down.
		C.asio_run_message_pump()

		globalASIOCapturerMu.Lock()
		globalASIOCapturer = nil
		globalASIOCapturerMu.Unlock()

		C.asio_release_driver()
		close(c.doneCh)
		runtime.UnlockOSThread()
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

/* ------------------------------------------------------------------ */
/* Registry enumeration (called from devices_asio.go)                 */
/* ------------------------------------------------------------------ */

func asioEnumerateDrivers() []Device {
	const maxDrv = 32
	var info [maxDrv]C.ASIODriverInfo
	count := int(C.asio_enumerate_drivers(&info[0], C.int(maxDrv)))

	devices := make([]Device, 0, count)
	for i := 0; i < count; i++ {
		name := C.GoString(&info[i].name[0])
		clsid := C.GoString(&info[i].clsid[0])
		if name == "" || clsid == "" {
			continue
		}
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
