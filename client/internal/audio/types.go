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
	// Channels overrides ChannelLeft/Right for ASIO: explicit 0-based channel list.
	// Used by multi-subscriber fan-out to open all needed channels in one session.
	Channels []int
	// NativeChannels is set by the capturer after Start() and reflects how many
	// interleaved channels the raw PCM buffer actually contains.
	NativeChannels int
}

type LevelUpdate struct {
	Left  float64 `json:"left"`
	Right float64 `json:"right"`
}

type Capturer interface {
	Start(ctx context.Context) error
	Stop()
	// Done is closed when the capturer stops — either intentionally (after Stop/ctx)
	// or unexpectedly (driver crash, device removed). Callers can watch this to
	// detect unexpected exits and trigger recovery.
	Done() <-chan struct{}
	OutputCh() <-chan []byte
	LevelCh() <-chan LevelUpdate
	ActualConfig() CaptureConfig
}

// MultiLevelCapturer extends Capturer with a raw PCM callback for per-subscriber
// level dispatch. Implemented by ASIOCapturer; no-op for WASAPI.
type MultiLevelCapturer interface {
	Capturer
	// SetMultiLevelCallback installs a callback invoked on every audio buffer
	// with the full interleaved int16 PCM for all open channels.
	// Called from the ASIO audio thread — must not block or retain pcm after return.
	SetMultiLevelCallback(func(frames int, pcm []int16))
}

// PCMFanOutCapturer extends Capturer with a byte-level PCM fan-out callback for
// multi-subscriber streaming. Implemented by ASIOCapturer.
type PCMFanOutCapturer interface {
	Capturer
	// SetPCMFanOutCallback installs a callback that receives every encoded PCM
	// buffer (multi-channel interleaved int16 LE) instead of sending to OutputCh.
	// Set to nil to revert to the normal single-consumer OutputCh path.
	SetPCMFanOutCallback(func(pcm []byte))
}
