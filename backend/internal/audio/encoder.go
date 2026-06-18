package audio

import (
	"fmt"
	"io"
	"os/exec"
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
	SampleRate uint32
	Channels   uint16
}

// Encoder wraps FFmpeg to encode raw PCM (s16le) to the configured format.
type Encoder struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
}

// NewEncoder creates and starts an FFmpeg encoder subprocess.
func NewEncoder(cfg EncoderConfig) (*Encoder, error) {
	outputFmt, codec := ffmpegFormat(cfg.Format)

	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-f", "s16le",
		"-ar", fmt.Sprintf("%d", cfg.SampleRate),
		"-ac", fmt.Sprintf("%d", cfg.Channels),
		"-i", "pipe:0",
		"-c:a", codec,
		"-b:a", fmt.Sprintf("%dk", cfg.Bitrate),
		"-f", outputFmt,
		"pipe:1",
	}

	cmd := exec.Command("ffmpeg", args...)

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
