//go:build windows && !asio

package audio

func NewCapturer(cfg CaptureConfig) Capturer {
	return &WasapiCapturer{
		cfg:    cfg,
		pcmOut: make(chan []byte, 32),
		levels: make(chan LevelUpdate, 16),
		stopCh: make(chan struct{}),
		doneCh: make(chan struct{}),
	}
}
