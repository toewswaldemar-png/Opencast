//go:build windows && !asio

package audio

func EnumerateInputDevices() ([]Device, error) {
	return enumerateWasapiDevices()
}
