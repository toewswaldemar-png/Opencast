//go:build windows

package ffmpeg

import (
	"archive/zip"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

// downloadURL points to a GPL static Windows x64 build from BtbN (~150 MB zip, ~75 MB exe).
const downloadURL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip"

var (
	mu         sync.Mutex
	cachedPath string
)

// Resolve returns a path to a usable ffmpeg executable.
// Order: system PATH → %LOCALAPPDATA%\Opencast\ffmpeg.exe → auto-download.
// On first download the ZIP (~150 MB) is fetched once and cached; subsequent
// calls return the cached path immediately.
func Resolve() (string, error) {
	mu.Lock()
	p := cachedPath
	mu.Unlock()
	if p != "" {
		return p, nil
	}

	p, err := resolve()
	if err != nil {
		return "", err
	}

	mu.Lock()
	cachedPath = p
	mu.Unlock()
	return p, nil
}

func resolve() (string, error) {
	// 1. System PATH (e.g. already installed by user)
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p, nil
	}

	// 2. Local cache from a previous auto-download
	cache, err := localCachePath()
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(cache); err == nil {
		return cache, nil
	}

	// 3. First run: download and extract
	log.Printf("[ffmpeg] nicht gefunden — lade statischen Build herunter (~150 MB) nach %s", cache)
	if err := downloadAndExtract(cache); err != nil {
		return "", fmt.Errorf("ffmpeg-Download fehlgeschlagen: %w", err)
	}
	log.Printf("[ffmpeg] erfolgreich installiert: %s", cache)
	return cache, nil
}

func localCachePath() (string, error) {
	base, err := os.UserCacheDir() // %LOCALAPPDATA%
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Opencast")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "ffmpeg.exe"), nil
}

func downloadAndExtract(dest string) error {
	tmp := dest + ".tmp"
	defer os.Remove(tmp)

	if err := httpDownload(downloadURL, tmp); err != nil {
		return err
	}
	return extractExe(tmp, dest)
}

func httpDownload(url, dest string) error {
	resp, err := http.Get(url) //nolint:noctx
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d für %s", resp.StatusCode, url)
	}

	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()

	total := resp.ContentLength
	var written, lastLogAt int64
	buf := make([]byte, 1<<20) // 1 MB chunks
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			written += int64(n)
			if total > 0 && written-lastLogAt >= 15<<20 { // log every ~15 MB
				log.Printf("[ffmpeg] Download: %.0f%%", float64(written)/float64(total)*100)
				lastLogAt = written
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	return nil
}

func extractExe(zipPath, dest string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("ZIP öffnen: %w", err)
	}
	defer r.Close()

	for _, f := range r.File {
		if filepath.Base(f.Name) == "ffmpeg.exe" && !f.FileInfo().IsDir() {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
			if err != nil {
				rc.Close()
				return err
			}
			_, err = io.Copy(out, rc)
			rc.Close()
			out.Close()
			return err
		}
	}
	return fmt.Errorf("ffmpeg.exe nicht in ZIP gefunden")
}
