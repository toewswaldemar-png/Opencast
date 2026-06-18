//go:build windows && !asio

package audio

import (
	"fmt"
	"runtime"

	"github.com/go-ole/go-ole"
	"github.com/moutend/go-wca/pkg/wca"
)

// EnumerateInputDevices lists all audio input devices via WASAPI, including disabled ones.
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
				// S_FALSE (0x1): already initialised — fine.
				// RPC_E_CHANGED_MODE (0x80010106): already MTA — continue anyway.
				if code != 0x00000001 && code != 0x80010106 {
					retErr = fmt.Errorf("CoInitializeEx: %w", err)
					return
				}
			}
		} else {
			defer ole.CoUninitialize()
		}

		var de *wca.IMMDeviceEnumerator
		if err := wca.CoCreateInstance(
			wca.CLSID_MMDeviceEnumerator, 0,
			wca.CLSCTX_ALL,
			wca.IID_IMMDeviceEnumerator,
			&de,
		); err != nil {
			retErr = fmt.Errorf("create device enumerator: %w", err)
			return
		}
		defer de.Release()

		// DEVICE_STATEMASK_ALL includes active, disabled, unplugged, not-present
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
			d.Release()

			devices = append(devices, Device{
				ID:                id,
				Name:              name,
				API:               APIWasapi,
				State:             wasapiDeviceState(state),
				MaxInputChannels:  2,
				DefaultSampleRate: 48000,
			})
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
