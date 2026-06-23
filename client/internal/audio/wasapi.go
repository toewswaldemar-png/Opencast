//go:build windows

package audio

import (
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"math"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
)

const (
	wasapiLoopbackFlag   = uint32(0x00020000) // AUDCLNT_STREAMFLAGS_LOOPBACK
	waveFormatIEEEFloat  = uint16(3)
	waveFormatExtensible = uint16(0xFFFE)
)

var ksdataformatSubtypeIEEEFloat = [16]byte{
	0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
	0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71,
}

// ── WasapiCapturer ───────────────────────────────────────────────────────────

type WasapiCapturer struct {
	cfg     CaptureConfig
	actual  CaptureConfig
	isFloat bool
	srcBPS  uint32

	pcmOut chan []byte
	levels chan LevelUpdate
	stopCh chan struct{}
	doneCh chan struct{}
}

func (c *WasapiCapturer) OutputCh() <-chan []byte     { return c.pcmOut }
func (c *WasapiCapturer) LevelCh() <-chan LevelUpdate { return c.levels }
func (c *WasapiCapturer) ActualConfig() CaptureConfig { return c.actual }

func (c *WasapiCapturer) isLoopback() bool {
	return strings.HasPrefix(c.cfg.DeviceID, "loopback:")
}

func (c *WasapiCapturer) Start(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(c.doneCh)

		if err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED); err != nil {
			if oleErr, ok := err.(*ole.OleError); ok {
				code := oleErr.Code()
				if code != 0x00000001 && code != 0x80010106 {
					errCh <- fmt.Errorf("CoInitializeEx: %w", err)
					return
				}
			}
		} else {
			defer ole.CoUninitialize()
		}

		de, ac, cc, err := c.initCapture()
		if err != nil {
			errCh <- err
			return
		}
		defer func() {
			ac.Stop()
			cc.Release()
			ac.Release()
			de.Release()
		}()

		close(errCh)
		c.captureLoop(ctx, ac, cc)
	}()
	return <-errCh
}

func (c *WasapiCapturer) initCapture() (*wca.IMMDeviceEnumerator, *wca.IAudioClient, *wca.IAudioCaptureClient, error) {
	var de *wca.IMMDeviceEnumerator
	if err := wca.CoCreateInstance(wca.CLSID_MMDeviceEnumerator, 0, wca.CLSCTX_ALL, wca.IID_IMMDeviceEnumerator, &de); err != nil {
		return nil, nil, nil, fmt.Errorf("create device enumerator: %w", err)
	}

	device, err := c.findDevice(de)
	if err != nil {
		de.Release()
		return nil, nil, nil, err
	}
	defer device.Release()

	var ac *wca.IAudioClient
	if err := device.Activate(wca.IID_IAudioClient, wca.CLSCTX_ALL, nil, &ac); err != nil {
		de.Release()
		return nil, nil, nil, fmt.Errorf("activate audio client: %w", err)
	}

	var mixFmt *wca.WAVEFORMATEX
	if err := ac.GetMixFormat(&mixFmt); err != nil {
		ac.Release()
		de.Release()
		return nil, nil, nil, fmt.Errorf("get mix format: %w", err)
	}
	defer ole.CoTaskMemFree(uintptr(unsafe.Pointer(mixFmt)))

	c.isFloat = wasapiIsFloat(mixFmt)
	c.srcBPS = uint32(mixFmt.WBitsPerSample) / 8
	c.actual = CaptureConfig{
		DeviceID:   c.cfg.DeviceID,
		SampleRate: mixFmt.NSamplesPerSec,
		Channels:   mixFmt.NChannels,
		BitDepth:   16,
	}

	var streamFlags uint32
	if c.isLoopback() {
		streamFlags = wasapiLoopbackFlag
	}
	const bufDuration = wca.REFERENCE_TIME(200 * 10000)
	if err := ac.Initialize(wca.AUDCLNT_SHAREMODE_SHARED, streamFlags, bufDuration, 0, mixFmt, nil); err != nil {
		ac.Release()
		de.Release()
		return nil, nil, nil, fmt.Errorf("initialize audio client: %w", err)
	}

	var cc *wca.IAudioCaptureClient
	if err := ac.GetService(wca.IID_IAudioCaptureClient, &cc); err != nil {
		ac.Release()
		de.Release()
		return nil, nil, nil, fmt.Errorf("get capture client: %w", err)
	}

	if err := ac.Start(); err != nil {
		cc.Release()
		ac.Release()
		de.Release()
		return nil, nil, nil, fmt.Errorf("start audio client: %w", err)
	}
	log.Printf("[wasapi] Capture gestartet: device=%s sr=%d ch=%d bits=%d float=%v",
		c.cfg.DeviceID, c.actual.SampleRate, c.actual.Channels, mixFmt.WBitsPerSample, c.isFloat)
	return de, ac, cc, nil
}

func wasapiIsFloat(f *wca.WAVEFORMATEX) bool {
	if f.WFormatTag == waveFormatIEEEFloat {
		return true
	}
	if f.WFormatTag == waveFormatExtensible {
		subFmt := (*[16]byte)(unsafe.Pointer(uintptr(unsafe.Pointer(f)) + 24))
		return *subFmt == ksdataformatSubtypeIEEEFloat
	}
	return false
}

func (c *WasapiCapturer) findDevice(de *wca.IMMDeviceEnumerator) (*wca.IMMDevice, error) {
	if c.cfg.DeviceID == "" || c.cfg.DeviceID == "default" {
		var d *wca.IMMDevice
		if err := de.GetDefaultAudioEndpoint(wca.ECapture, wca.ECommunications, &d); err != nil {
			return nil, fmt.Errorf("get default capture device: %w", err)
		}
		return d, nil
	}

	if c.isLoopback() {
		targetID := strings.TrimPrefix(c.cfg.DeviceID, "loopback:")
		var dc *wca.IMMDeviceCollection
		if err := de.EnumAudioEndpoints(wca.ERender, wca.DEVICE_STATEMASK_ALL, &dc); err != nil {
			return nil, fmt.Errorf("EnumAudioEndpoints render: %w", err)
		}
		defer dc.Release()
		var count uint32
		dc.GetCount(&count)
		for i := uint32(0); i < count; i++ {
			var d *wca.IMMDevice
			if err := dc.Item(i, &d); err != nil {
				continue
			}
			var id string
			d.GetId(&id)
			if id == targetID {
				return d, nil
			}
			d.Release()
		}
		return nil, fmt.Errorf("loopback device %q not found", targetID)
	}

	var dc *wca.IMMDeviceCollection
	if err := de.EnumAudioEndpoints(wca.ECapture, wca.DEVICE_STATEMASK_ALL, &dc); err != nil {
		return nil, fmt.Errorf("EnumAudioEndpoints: %w", err)
	}
	defer dc.Release()

	var count uint32
	dc.GetCount(&count)
	for i := uint32(0); i < count; i++ {
		var d *wca.IMMDevice
		if err := dc.Item(i, &d); err != nil {
			continue
		}
		var id string
		d.GetId(&id)
		if id == c.cfg.DeviceID {
			return d, nil
		}
		d.Release()
	}
	return nil, fmt.Errorf("device %q not found", c.cfg.DeviceID)
}

func (c *WasapiCapturer) captureLoop(ctx context.Context, ac *wca.IAudioClient, cc *wca.IAudioCaptureClient) {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
			return
		case <-ticker.C:
			c.readAvailablePackets(cc)
		}
	}
}

func (c *WasapiCapturer) readAvailablePackets(cc *wca.IAudioCaptureClient) {
	for {
		var data *byte
		var numFrames, flags uint32
		if err := cc.GetBuffer(&data, &numFrames, &flags, nil, nil); err != nil {
			break
		}
		if numFrames == 0 {
			cc.ReleaseBuffer(0)
			break
		}

		byteCount := numFrames * uint32(c.actual.Channels) * c.srcBPS
		raw := make([]byte, byteCount)
		if flags&wca.AUDCLNT_BUFFERFLAGS_SILENT == 0 {
			copy(raw, unsafe.Slice(data, byteCount))
		}
		cc.ReleaseBuffer(numFrames)

		var pcm []byte
		switch {
		case c.isFloat:
			pcm = wasapiF32ToI16(raw)
		case c.srcBPS == 2:
			pcm = raw
		default:
			pcm = wasapiIntToI16(raw, c.srcBPS)
		}

		c.sendLevels(pcm)
		select {
		case c.pcmOut <- pcm:
		default:
		}
	}
}

func wasapiF32ToI16(src []byte) []byte {
	n := len(src) / 4
	out := make([]byte, n*2)
	for i := range n {
		bits := binary.LittleEndian.Uint32(src[i*4:])
		f := math.Float32frombits(bits)
		if f > 1 {
			f = 1
		} else if f < -1 {
			f = -1
		}
		binary.LittleEndian.PutUint16(out[i*2:], uint16(int16(f*32767)))
	}
	return out
}

// wasapiIntToI16 converts interleaved 24- or 32-bit integer LE PCM to int16 LE.
func wasapiIntToI16(src []byte, srcBPS uint32) []byte {
	n := int(srcBPS)
	if n == 0 || len(src) == 0 {
		return nil
	}
	samples := len(src) / n
	out := make([]byte, samples*2)
	for i := range samples {
		off := i * n
		var v int32
		switch n {
		case 3:
			v = int32(src[off]) | int32(src[off+1])<<8 | int32(int8(src[off+2]))<<16
			v <<= 8
		case 4:
			v = int32(binary.LittleEndian.Uint32(src[off:]))
		default:
			v = int32(int16(binary.LittleEndian.Uint16(src[off:]))) << 16
		}
		binary.LittleEndian.PutUint16(out[i*2:], uint16(int16(v>>16)))
	}
	return out
}

func (c *WasapiCapturer) sendLevels(pcm []byte) {
	if len(pcm) < 2 {
		return
	}
	var peakL, peakR float64
	ch := int(c.actual.Channels)
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

func (c *WasapiCapturer) Stop() {
	select {
	case <-c.stopCh:
	default:
		close(c.stopCh)
	}
	<-c.doneCh
}

// ── WASAPI device helpers (shared by devices.go and devices_asio.go) ─────────

func wasapiDeviceState(s uint32) DeviceState {
	switch s {
	case wca.DEVICE_STATE_ACTIVE:
		return StateActive
	case wca.DEVICE_STATE_DISABLED:
		return StateDisabled
	case wca.DEVICE_STATE_UNPLUGGED:
		return StateUnplugged
	default:
		return StateNotPresent
	}
}

func wasapiDeviceMixFormat(d *wca.IMMDevice) (channels int, sampleRate float64) {
	var ac *wca.IAudioClient
	if err := d.Activate(wca.IID_IAudioClient, wca.CLSCTX_ALL, nil, &ac); err != nil {
		return 2, 48000
	}
	defer ac.Release()
	var wfmt *wca.WAVEFORMATEX
	if err := ac.GetMixFormat(&wfmt); err != nil {
		return 2, 48000
	}
	defer ole.CoTaskMemFree(uintptr(unsafe.Pointer(wfmt)))
	return int(wfmt.NChannels), float64(wfmt.NSamplesPerSec)
}

func wasapiDeviceFriendlyName(d *wca.IMMDevice) string {
	var ps *wca.IPropertyStore
	if err := d.OpenPropertyStore(wca.STGM_READ, &ps); err != nil {
		return "Unbekanntes Gerät"
	}
	defer ps.Release()
	var pv wca.PROPVARIANT
	key := wca.PKEY_Device_FriendlyName
	if err := ps.GetValue(&key, &pv); err != nil {
		return "Unbekanntes Gerät"
	}
	return pv.String()
}

func enumerateWasapiDevices() ([]Device, error) {
	var devices []Device
	var retErr error

	done := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(done)

		if err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED); err != nil {
			if oleErr, ok := err.(*ole.OleError); ok {
				code := oleErr.Code()
				if code != 0x00000001 && code != 0x80010106 {
					retErr = fmt.Errorf("CoInitializeEx: %w", err)
					return
				}
			}
		} else {
			defer ole.CoUninitialize()
		}

		var de *wca.IMMDeviceEnumerator
		if err := wca.CoCreateInstance(wca.CLSID_MMDeviceEnumerator, 0, wca.CLSCTX_ALL, wca.IID_IMMDeviceEnumerator, &de); err != nil {
			retErr = fmt.Errorf("create device enumerator: %w", err)
			return
		}
		defer de.Release()

		// Capture (input) endpoints
		var dc *wca.IMMDeviceCollection
		if err := de.EnumAudioEndpoints(wca.ECapture, wca.DEVICE_STATEMASK_ALL, &dc); err != nil {
			retErr = fmt.Errorf("EnumAudioEndpoints: %w", err)
			return
		}
		defer dc.Release()

		var count uint32
		if err := dc.GetCount(&count); err != nil {
			retErr = fmt.Errorf("GetCount: %w", err)
			return
		}

		for i := uint32(0); i < count; i++ {
			var d *wca.IMMDevice
			if err := dc.Item(i, &d); err != nil {
				continue
			}
			var id string
			d.GetId(&id)
			var state uint32
			d.GetState(&state)
			name := wasapiDeviceFriendlyName(d)
			ch, sr := wasapiDeviceMixFormat(d)
			d.Release()

			devices = append(devices, Device{
				ID:                id,
				Name:              name,
				API:               APIWasapi,
				State:             wasapiDeviceState(state),
				MaxInputChannels:  ch,
				DefaultSampleRate: sr,
			})
		}

		// Render (output) endpoints as loopback sources.
		// Active render endpoints can be captured via WASAPI loopback,
		// which is how virtual routing devices like ReaRoute or VoiceMeeter work.
		var dcRender *wca.IMMDeviceCollection
		if err := de.EnumAudioEndpoints(wca.ERender, wca.DEVICE_STATE_ACTIVE, &dcRender); err == nil {
			defer dcRender.Release()
			var renderCount uint32
			dcRender.GetCount(&renderCount)
			for i := uint32(0); i < renderCount; i++ {
				var d *wca.IMMDevice
				if err := dcRender.Item(i, &d); err != nil {
					continue
				}
				var id string
				d.GetId(&id)
				name := wasapiDeviceFriendlyName(d)
				ch, sr := wasapiDeviceMixFormat(d)
				d.Release()

				devices = append(devices, Device{
					ID:                "loopback:" + id,
					Name:              name + " (Loopback)",
					API:               APIWasapi,
					State:             StateActive,
					MaxInputChannels:  ch,
					DefaultSampleRate: sr,
					Loopback:          true,
				})
			}
		}
	}()
	<-done
	return devices, retErr
}
