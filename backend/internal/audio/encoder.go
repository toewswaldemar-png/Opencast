package audio

import (
	"fmt"
	"io"
	"os/exec"

	"opencast/internal/ffmpeg"
)

type Format string

const (
	FormatMP3    Format = "mp3"
	FormatAAC    Format = "aac"
	FormatVorbis Format = "ogg"
)

// ContentType returns the MIME type for the encoded format.
func (f Format) ContentType() string {
	switch f {
	case FormatMP3:
		return "audio/mpeg"
	case FormatAAC:
		return "audio/aac"
	case FormatVorbis:
		return "audio/ogg"
	default:
		return "audio/mpeg"
	}
}

type EncoderConfig struct {
	Format     Format
	Bitrate    int
	SampleRate uint32 // target output sample rate
	Channels   uint16 // target output channels
	// InputSampleRate / InputChannels describe the raw PCM coming in.
	// If zero, they fall back to SampleRate / Channels (no resampling).
	InputSampleRate uint32
	InputChannels   uint16
}

// Encoder wraps FFmpeg to encode raw PCM (s16le) to the configured format.
type Encoder struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
}

// NewEncoder creates and starts an FFmpeg encoder subprocess.
func NewEncoder(cfg EncoderConfig) (*Encoder, error) {
	ffExe, err := ffmpeg.Resolve()
	if err != nil {
		return nil, fmt.Errorf("create encoder: %w", err)
	}

	outputFmt, codec := ffmpegFormat(cfg.Format)

	inRate := cfg.InputSampleRate
	if inRate == 0 {
		inRate = cfg.SampleRate
	}
	inCh := cfg.InputChannels
	if inCh == 0 {
		inCh = cfg.Channels
	}

	args := []string{
		"-hide_banner", "-loglevel", "error",
		// Input format: s16le at the device's actual rate
		"-f", "s16le",
		"-ar", fmt.Sprintf("%d", inRate),
		"-ac", fmt.Sprintf("%d", inCh),
		"-i", "pipe:0",
		"-c:a", codec,
		"-b:a", fmt.Sprintf("%dk", cfg.Bitrate),
		// Output sample rate / channels (FFmpeg resamples as needed)
		"-ar", fmt.Sprintf("%d", cfg.SampleRate),
		"-ac", fmt.Sprintf("%d", cfg.Channels),
		"-f", outputFmt,
		"pipe:1",
	}

	cmd := exec.Command(ffExe, args...)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start ffmpeg: %w (is ffmpeg in PATH?)", err)
	}

	return &Encoder{cmd: cmd, stdin: stdin, stdout: stdout}, nil
}

func (e *Encoder) Write(pcm []byte) (int, error) { return e.stdin.Write(pcm) }
func (e *Encoder) Output() io.Reader              { return e.stdout }

func (e *Encoder) Close() error {
	e.stdin.Close()
	return e.cmd.Wait()
}

func ffmpegFormat(f Format) (outputFmt, codec string) {
	switch f {
	case FormatMP3:
		return "mp3", "libmp3lame"
	case FormatAAC:
		return "adts", "aac"
	case FormatVorbis:
		return "ogg", "libvorbis"
	default:
		return "mp3", "libmp3lame"
	}
}
