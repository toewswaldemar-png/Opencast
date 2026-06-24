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
	DeviceID     string
	SampleRate   uint32
	ChannelLeft  uint16 // 1-based input channel for L (0 = use default: 1)
	ChannelRight uint16 // 1-based input channel for R (0 = use default: 2)
	BitDepth     uint16
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
