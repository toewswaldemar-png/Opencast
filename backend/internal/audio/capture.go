//go:build windows && !asio

package audio

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"runtime"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
)

const (
	waveFormatPCM        = uint16(1)
	waveFormatIEEEFloat  = uint16(3)
	waveFormatExtensible = uint16(0xFFFE)
)

// ksdataformatSubtypeIEEEFloat is the SubFormat GUID for 32-bit IEEE float
// in a WAVEFORMATEXTENSIBLE struct (little-endian).
var ksdataformatSubtypeIEEEFloat = [16]byte{
	0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
	0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71,
}

// WasapiCapturer captures audio from a WASAPI device in shared mode.
// It negotiates the device's native mix format and converts to s16le.
type WasapiCapturer struct {
	cfg    CaptureConfig
	actual CaptureConfig // negotiated after Start
	isFloat bool         // device outputs IEEE 754 float32
	srcBPS  uint32       // bytes per sample from device (2 or 4)

	pcmOut chan []byte
	levels chan LevelUpdate
	stopCh chan struct{}
	doneCh chan struct{}
}

// NewCapturer returns a WASAPI-backed Capturer.
func NewCapturer(cfg CaptureConfig) Capturer {
	return &WasapiCapturer{
		cfg:    cfg,
		pcmOut: make(chan []byte, 32),
		levels: make(chan LevelUpdate, 16),
		stopCh: make(chan struct{}),
		doneCh: make(chan struct{}),
	}
}

func (c *WasapiCapturer) OutputCh() <-chan []byte      { return c.pcmOut }
func (c *WasapiCapturer) LevelCh() <-chan LevelUpdate  { return c.levels }
func (c *WasapiCapturer) ActualConfig() CaptureConfig  { return c.actual }

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
	if err := wca.CoCreateInstance(
		wca.CLSID_MMDeviceEnumerator, 0,
		wca.CLSCTX_ALL,
		wca.IID_IMMDeviceEnumerator,
		&de,
	); err != nil {
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

	// Use the device's native mix format — mandatory for shared-mode capture.
	var mixFmt *wca.WAVEFORMATEX
	if err := ac.GetMixFormat(&mixFmt); err != nil {
		ac.Release()
		de.Release()
		return nil, nil, nil, fmt.Errorf("get mix format: %w", err)
	}
	defer ole.CoTaskMemFree(uintptr(unsafe.Pointer(mixFmt)))

	c.isFloat = isFloatFormat(mixFmt)
	c.srcBPS = uint32(mixFmt.WBitsPerSample) / 8
	c.actual = CaptureConfig{
		DeviceID:   c.cfg.DeviceID,
		SampleRate: mixFmt.NSamplesPerSec,
		Channels:   mixFmt.NChannels,
		BitDepth:   16, // output is always s16le after conversion
	}

	const bufDuration = wca.REFERENCE_TIME(200 * 10000)
	if err := ac.Initialize(wca.AUDCLNT_SHAREMODE_SHARED, 0, bufDuration, 0, mixFmt, nil); err != nil {
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

	return de, ac, cc, nil
}

// isFloatFormat returns true when the device uses IEEE 754 float32 samples.
func isFloatFormat(f *wca.WAVEFORMATEX) bool {
	if f.WFormatTag == waveFormatIEEEFloat {
		return true
	}
	if f.WFormatTag == waveFormatExtensible {
		// WAVEFORMATEX is 18 bytes; SubFormat GUID sits at offset 24
		// (18 base + 2 Samples union + 4 ChannelMask = 24).
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
		if c.isFloat {
			pcm = float32ToInt16LE(raw, c.actual.Channels)
		} else {
			pcm = raw
		}

		c.sendLevels(pcm)

		select {
		case c.pcmOut <- pcm:
		default:
		}
	}
}

// float32ToInt16LE converts interleaved IEEE float32 LE samples to int16 LE.
func float32ToInt16LE(src []byte, _ uint16) []byte {
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
		s := int16(f * 32767)
		binary.LittleEndian.PutUint16(out[i*2:], uint16(s))
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
		sL := math.Abs(float64(int16(pcm[i])|int16(pcm[i+1])<<8) / 32768.0)
		if sL > peakL {
			peakL = sL
		}
		if ch >= 2 && i+3 < len(pcm) {
			sR := math.Abs(float64(int16(pcm[i+2])|int16(pcm[i+3])<<8) / 32768.0)
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
