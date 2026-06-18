//go:build windows && !asio

package audio

import (
	"context"
	"fmt"
	"math"
	"runtime"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
)

// WasapiCapturer captures audio from a WASAPI device.
type WasapiCapturer struct {
	cfg    CaptureConfig
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

	wfx := &wca.WAVEFORMATEX{
		WFormatTag:      wca.WAVE_FORMAT_PCM,
		NChannels:       c.cfg.Channels,
		NSamplesPerSec:  c.cfg.SampleRate,
		WBitsPerSample:  c.cfg.BitDepth,
		NBlockAlign:     c.cfg.Channels * (c.cfg.BitDepth / 8),
		NAvgBytesPerSec: c.cfg.SampleRate * uint32(c.cfg.Channels) * uint32(c.cfg.BitDepth/8),
	}

	const bufDuration = wca.REFERENCE_TIME(200 * 10000)
	if err := ac.Initialize(wca.AUDCLNT_SHAREMODE_SHARED, 0, bufDuration, 0, wfx, nil); err != nil {
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

		bytesPerFrame := uint32(c.cfg.Channels) * uint32(c.cfg.BitDepth/8)
		byteCount := numFrames * bytesPerFrame
		buf := make([]byte, byteCount)

		if flags&wca.AUDCLNT_BUFFERFLAGS_SILENT == 0 {
			copy(buf, unsafe.Slice(data, byteCount))
		}
		cc.ReleaseBuffer(numFrames)

		c.sendLevels(buf)

		select {
		case c.pcmOut <- buf:
		default:
		}
	}
}

func (c *WasapiCapturer) sendLevels(pcm []byte) {
	if len(pcm) < 2 {
		return
	}
	var peakL, peakR float64
	ch := int(c.cfg.Channels)

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
