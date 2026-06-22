//go:build windows

package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/getlantern/systray"

	"client/internal/audio"
	"client/internal/config"
	"client/internal/stream"
	"client/internal/wsclient"
)

var (
	cfg     config.Config
	ws      *wsclient.Client
	manager *stream.Manager
	monitor *stream.Monitor

	mu          sync.Mutex
	asioDevices []audio.Device // ASIO devices for tray submenu
)

func main() {
	// Log to file next to the executable so logs are visible even with -H windowsgui.
	if exe, err := os.Executable(); err == nil {
		logPath := filepath.Join(filepath.Dir(exe), "opencast-client.log")
		if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644); err == nil {
			log.SetOutput(f)
		}
	}

	store, err := config.NewStore()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	cfg = store.Get()

	manager = stream.NewManager()
	monitor = stream.NewMonitor()

	systray.Run(onReady, onExit)
}

func onReady() {
	systray.SetIcon(generateIcon())
	systray.SetTitle("Opencast")
	systray.SetTooltip("Opencast Client — " + cfg.ServerURL)

	mStatus := systray.AddMenuItem("Verbinde…", "Server-Verbindungsstatus")
	mStatus.Disable()
	systray.AddSeparator()

	mWebUI := systray.AddMenuItem("Web-UI öffnen", "Browser mit dem Server-Interface öffnen")
	systray.AddSeparator()

	// ASIO Panel submenu (only populated when ASIO devices are found)
	mASIO := systray.AddMenuItem("ASIO Panel", "ASIO Treiber-Einstellungen öffnen")
	mASIO.Disable()
	systray.AddSeparator()

	mQuit := systray.AddMenuItem("Beenden", "Opencast Client beenden")

	// Start WebSocket client
	ctx, _ := context.WithCancel(context.Background()) //nolint:govet

	ws = wsclient.New(cfg.ServerURL, wsclient.Handlers{
		OnStart: func(p wsclient.CmdStartPayload) {
			go handleStart(p)
		},
		OnStop: func(p wsclient.CmdStopPayload) {
			go manager.Stop(p.StreamID)
		},
		OnMonitorStart: func(p wsclient.CmdMonitorPayload) {
			log.Printf("[monitor] cmd:monitor:start empfangen — device=%s sr=%d ch=%d",
				p.DeviceID, p.SampleRate, p.Channels)
			if err := monitor.Start(stream.MonitorConfig{
				DeviceID:   p.DeviceID,
				SampleRate: p.SampleRate,
				Channels:   p.Channels,
			}); err != nil {
				log.Printf("[monitor] Start fehlgeschlagen (device=%s): %v", p.DeviceID, err)
				if ws != nil {
					ws.SendError("monitor", err.Error())
				}
			} else {
				log.Printf("[monitor] Monitor läuft: device=%s", p.DeviceID)
			}
		},
		OnMonitorStop: func() {
			monitor.Stop()
		},
		OnAsioPanel: func(deviceID string) {
			clsid := strings.TrimPrefix(deviceID, "asio:")
			audio.OpenASIOControlPanel(clsid)
		},
	})

	manager.SetLevelCallback(func(streamID string, lvl audio.LevelUpdate) {
		if ws != nil {
			ws.SendLevel(streamID, lvl)
		}
	})
	manager.SetStatusCallback(func(streamID string, running, connected bool, bytesSent int64, uptime time.Duration) {
		if ws != nil {
			ws.SendStatus(streamID, running, connected, bytesSent, uptime)
		}
	})

	monitor.SetLevelCallback(func(lvl audio.LevelUpdate) {
		if ws != nil {
			ws.SendMonitorLevel(lvl)
		}
	})

	go ws.Run(ctx)

	// Discover ASIO devices for the tray menu
	go func() {
		devs, err := audio.EnumerateInputDevices()
		if err != nil {
			return
		}
		var asio []audio.Device
		for _, d := range devs {
			if d.API == audio.APIAsio {
				asio = append(asio, d)
			}
		}
		if len(asio) > 0 {
			mu.Lock()
			asioDevices = asio
			mu.Unlock()
			mASIO.Enable()
			if len(asio) == 1 {
				mASIO.SetTitle(fmt.Sprintf("ASIO Panel — %s", asio[0].Name))
			}
		}
	}()

	// Event loop
	for {
		select {
		case <-mWebUI.ClickedCh:
			openBrowser(cfg.ServerURL)

		case <-mASIO.ClickedCh:
			mu.Lock()
			devs := asioDevices
			mu.Unlock()
			if len(devs) == 1 {
				clsid := strings.TrimPrefix(devs[0].ID, "asio:")
				audio.OpenASIOControlPanel(clsid)
			} else if len(devs) > 1 {
				// Multiple ASIO devices: open the first one (simple)
				// TODO: submenu per device
				clsid := strings.TrimPrefix(devs[0].ID, "asio:")
				audio.OpenASIOControlPanel(clsid)
			}

		case <-mQuit.ClickedCh:
			manager.StopAll()
			monitor.Stop()
			systray.Quit()
			return
		}
	}
}

func onExit() {
	manager.StopAll()
	monitor.Stop()
}

func handleStart(p wsclient.CmdStartPayload) {
	// ASIO allows only one active driver instance at a time.
	// Stop the monitor first so it releases g_asio before we open it for streaming.
	if strings.HasPrefix(p.DeviceID, "asio:") {
		monitor.Stop()
	}

	format := audio.Format(p.Format)
	ingestURL := p.IngestURL
	if ingestURL == "" {
		ingestURL = wsclient.BuildIngestURL(cfg.ServerURL, p.StreamID)
	}

	err := manager.Start(stream.Config{
		StreamID:   p.StreamID,
		DeviceID:   p.DeviceID,
		IngestURL:  ingestURL,
		Format:     format,
		Bitrate:    p.Bitrate,
		SampleRate: p.SampleRate,
		Channels:   p.Channels,
	})
	if err != nil {
		log.Printf("[stream/%s] Start fehlgeschlagen: %v", p.StreamID, err)
		if ws != nil {
			ws.SendError(p.StreamID, err.Error())
		}
	}
}

func openBrowser(url string) {
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func generateIcon() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 16, 16))
	orange := color.RGBA{R: 255, G: 107, B: 0, A: 255}
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			img.Set(x, y, orange)
		}
	}
	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}
