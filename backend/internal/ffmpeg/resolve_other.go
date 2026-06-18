//go:build !windows

package ffmpeg

import "fmt"

func Resolve() (string, error) {
	return "", fmt.Errorf("nur unter Windows unterstützt")
}
