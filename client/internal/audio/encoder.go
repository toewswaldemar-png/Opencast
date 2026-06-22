package audio

import (
	"fmt"
	"io"
	"os/exec"

	"client/internal/ffmpeg"
)

type Format string

const (
	FormatMP3    Format = "mp3"
	FormatAAC    Format = "aac"
	FormatVorbis Format = "ogg"
)

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
	Format          Format
	Bitrate         int
	SampleRate      uint32
	Channels        uint16
	InputSampleRate uint32
	InputChannels   uint16
}

type Encoder struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
}

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
		"-fflags", "+nobuffer",
		"-f", "s16le",
		"-ar", fmt.Sprintf("%d", inRate),
		"-ac", fmt.Sprintf("%d", inCh),
		"-i", "pipe:0",
		"-c:a", codec,
		"-b:a", fmt.Sprintf("%dk", cfg.Bitrate),
		"-ar", fmt.Sprintf("%d", cfg.SampleRate),
		"-ac", fmt.Sprintf("%d", cfg.Channels),
		"-flush_packets", "1",
		"-f", outputFmt,
		"pipe:1",
	}

	cmd := exec.Command(ffExe, args...)
	setupEncoderCmd(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start ffmpeg: %w (ist ffmpeg im PATH?)", err)
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
