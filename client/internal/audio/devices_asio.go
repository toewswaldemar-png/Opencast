//go:build windows && asio

package audio

func EnumerateInputDevices() ([]Device, error) {
	wasapi, err := enumerateWasapiDevices()
	if err != nil {
		return nil, err
	}
	return append(wasapi, asioEnumerateDrivers()...), nil
}
