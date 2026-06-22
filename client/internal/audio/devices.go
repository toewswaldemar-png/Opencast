//go:build windows && !asio

package audio

import (
	"fmt"
	"runtime"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
)

func EnumerateInputDevices() ([]Device, error) {
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

		// Regular capture (input) endpoints
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
			name := deviceFriendlyName(d)
			ch, sr := deviceMixFormat(d)
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

		// Render (output) endpoints — exposed as loopback sources.
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
				name := deviceFriendlyName(d)
				ch, sr := deviceMixFormat(d)
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

func deviceMixFormat(d *wca.IMMDevice) (channels int, sampleRate float64) {
	var ac *wca.IAudioClient
	if err := d.Activate(wca.IID_IAudioClient, wca.CLSCTX_ALL, nil, &ac); err != nil {
		return 2, 48000
	}
	defer ac.Release()

	var fmt *wca.WAVEFORMATEX
	if err := ac.GetMixFormat(&fmt); err != nil {
		return 2, 48000
	}
	defer ole.CoTaskMemFree(uintptr(unsafe.Pointer(fmt)))
	return int(fmt.NChannels), float64(fmt.NSamplesPerSec)
}

func deviceFriendlyName(d *wca.IMMDevice) string {
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
