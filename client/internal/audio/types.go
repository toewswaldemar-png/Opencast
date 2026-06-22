package audio

import "context"

type APIType string

const (
	APIWasapi      APIType = "WASAPI"
	APIAsio        APIType = "ASIO"
	APIDirectSound APIType = "DirectSound"
)

type DeviceState string

const (
	StateActive     DeviceState = "active"
	StateDisabled   DeviceState = "disabled"
	StateUnplugged  DeviceState = "unplugged"
	StateNotPresent DeviceState = "notpresent"
)

type Device struct {
	ID                string      `json:"id"`
	Name              string      `json:"name"`
	API               APIType     `json:"api"`
	State             DeviceState `json:"state"`
	MaxInputChannels  int         `json:"maxInputChannels"`
	DefaultSampleRate float64     `json:"defaultSampleRate"`
	Loopback          bool        `json:"loopback"`
}

type CaptureConfig struct {
	DeviceID   string
	SampleRate uint32
	Channels   uint16
	BitDepth   uint16
}

type LevelUpdate struct {
	Left  float64 `json:"left"`
	Right float64 `json:"right"`
}

type Capturer interface {
	Start(ctx context.Context) error
	Stop()
	OutputCh() <-chan []byte
	LevelCh() <-chan LevelUpdate
	ActualConfig() CaptureConfig
}
