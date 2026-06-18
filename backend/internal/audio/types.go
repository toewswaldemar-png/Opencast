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
}

// CaptureConfig holds parameters for audio capture.
type CaptureConfig struct {
	DeviceID   string
	SampleRate uint32
	Channels   uint16
	BitDepth   uint16
}

// LevelUpdate carries peak levels for left and right channels in dBFS.
type LevelUpdate struct {
	Left  float64 `json:"left"`
	Right float64 `json:"right"`
}

// Capturer is the common interface for WASAPI and ASIO capture backends.
type Capturer interface {
	Start(ctx context.Context) error
	Stop()
	OutputCh() <-chan []byte
	LevelCh() <-chan LevelUpdate
	// ActualConfig returns the negotiated device format (known after Start).
	ActualConfig() CaptureConfig
}

