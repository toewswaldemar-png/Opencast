//go:build windows

package audio

import (
	"os/exec"
	"syscall"
)

func setupEncoderCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
