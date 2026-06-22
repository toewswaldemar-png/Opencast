//go:build !windows

package audio

import "os/exec"

func setupEncoderCmd(cmd *exec.Cmd) {}
