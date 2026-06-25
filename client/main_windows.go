//go:build windows

package main

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"client/internal/audio"
	"client/internal/config"
	"client/internal/hub"
	"client/internal/wsclient"

	"github.com/getlantern/systray"
)

var (
	cfg      config.Config
	ws       *wsclient.Client
	registry *hub.Registry

	mu          sync.Mutex
	asioDevices []audio.Device
)

func main() {
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
	registry = hub.NewRegistry()

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

	mASIO := systray.AddMenuItem("ASIO Panel", "ASIO Treiber-Einstellungen öffnen")
	mASIO.Disable()
	systray.AddSeparator()

	mQuit := systray.AddMenuItem("Beenden", "Opencast Client beenden")

	ctx, cancelCtx := context.WithCancel(context.Background())

	ws = wsclient.New(cfg.ServerURL, wsclient.Handlers{
		OnStart: func(p wsclient.CmdStartPayload) {
			go func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[stream/%s] PANIC: %v", p.StreamID, r)
						if ws != nil {
							ws.SendError(p.StreamID, fmt.Sprintf("client panic: %v", r))
						}
					}
				}()

				ingestURL := p.IngestURL
				if ingestURL == "" {
					ingestURL = wsclient.BuildIngestURL(cfg.ServerURL, p.StreamID)
				}

				err := registry.Hub(p.DeviceID).StartStream(
					p.StreamID, p.ChannelLeft, p.ChannelRight, p.SampleRate,
					hub.StreamConfig{
						IngestURL:  ingestURL,
						Format:     audio.Format(p.Format),
						Bitrate:    p.Bitrate,
						SampleRate: p.SampleRate,
						IngestFunc: wsclient.PutIngest,
					},
					hub.Callbacks{
						OnLevel: func(lvl audio.LevelUpdate) {
							if ws != nil {
								ws.SendLevel(p.StreamID, lvl)
							}
						},
						OnStatus: func(running, connected bool, bytesSent int64, uptime time.Duration) {
							if ws != nil {
								ws.SendStatus(p.StreamID, running, connected, bytesSent, uptime)
							}
						},
						OnError: func(msg string) {
							if ws != nil {
								ws.SendError(p.StreamID, msg)
								ws.SendStatus(p.StreamID, false, false, 0, 0)
							}
						},
					},
				)
				if err != nil {
					log.Printf("[stream/%s] StartStream fehlgeschlagen: %v", p.StreamID, err)
					if ws != nil {
						ws.SendError(p.StreamID, err.Error())
						ws.SendStatus(p.StreamID, false, false, 0, 0)
					}
				}
			}()
		},

		OnStop: func(p wsclient.CmdStopPayload) {
			go registry.Unsubscribe(p.StreamID)
		},

		OnMonitorStart: func(p wsclient.CmdMonitorPayload) {
			go func() {
				// Remove from any other hub first (device may have changed).
				registry.UnsubscribeExcept(p.MonitorID, p.DeviceID)
				err := registry.Hub(p.DeviceID).Subscribe(
					p.MonitorID, p.ChannelLeft, p.ChannelRight, p.SampleRate,
					hub.Callbacks{
						OnLevel: func(lvl audio.LevelUpdate) {
							if ws != nil {
								ws.SendMonitorLevel(p.MonitorID, lvl)
							}
						},
					},
				)
				if err != nil {
					log.Printf("[monitor/%s] Subscribe fehlgeschlagen: %v", p.MonitorID, err)
					if ws != nil {
						ws.SendError("monitor:"+p.MonitorID, err.Error())
					}
				} else {
					log.Printf("[monitor/%s] Monitor läuft: device=%s", p.MonitorID, p.DeviceID)
				}
			}()
		},

		OnMonitorStop: func() {
			registry.StopMonitors()
		},

		OnMonitorStopCard: func(monitorID string) {
			go registry.Unsubscribe(monitorID)
		},

		OnAsioPanel: func(deviceID string) {
			go func() {
				clsid := strings.TrimPrefix(deviceID, "asio:")
				// Stop capturer so asioGlobalMu is free while the panel is open.
				registry.Hub(deviceID).StopCapturer()
				audio.OpenASIOControlPanelSync(clsid)
				// Refresh device list (channel counts may have changed).
				if ws != nil {
					ws.SendDevices()
				}
				// Restart capturer — subscribers are still registered in the Hub.
				registry.Hub(deviceID).ReopenCapturer()
			}()
		},

		OnConnected: func() {
			mStatus.SetTitle("Verbunden")
		},
		OnDisconnected: func() {
			mStatus.SetTitle("Verbinde…")
		},
	})

	go ws.Run(ctx)

	// Discover ASIO devices for the tray menu.
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

	for {
		select {
		case <-mWebUI.ClickedCh:
			openBrowser(cfg.ServerURL)

		case <-mASIO.ClickedCh:
			mu.Lock()
			devs := asioDevices
			mu.Unlock()
			if len(devs) >= 1 {
				clsid := strings.TrimPrefix(devs[0].ID, "asio:")
				audio.OpenASIOControlPanel(clsid)
			}

		case <-mQuit.ClickedCh:
			cancelCtx()
			registry.StopAll()
			systray.Quit()
			return
		}
	}
}

func onExit() {
	registry.StopAll()
}

func openBrowser(url string) {
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start() //nolint:errcheck
}

// generateIcon returns a 16x16 solid-orange Windows .ico file in memory.
func generateIcon() []byte {
	const w, h = 16, 16

	xor := make([]byte, w*h*4)
	for i := 0; i < w*h; i++ {
		xor[i*4+0] = 0x00
		xor[i*4+1] = 0x6B
		xor[i*4+2] = 0xFF
		xor[i*4+3] = 0xFF
	}

	const andStride = 4
	and := make([]byte, h*andStride)

	dibSize := uint32(40 + len(xor) + len(and))

	var buf bytes.Buffer
	w16 := func(v uint16) { buf.WriteByte(byte(v)); buf.WriteByte(byte(v >> 8)) }
	w32 := func(v uint32) {
		buf.WriteByte(byte(v)); buf.WriteByte(byte(v >> 8))
		buf.WriteByte(byte(v >> 16)); buf.WriteByte(byte(v >> 24))
	}

	w16(0); w16(1); w16(1)
	buf.WriteByte(w); buf.WriteByte(h); buf.WriteByte(0); buf.WriteByte(0)
	w16(1); w16(32)
	w32(dibSize); w32(22)
	w32(40); w32(uint32(w)); w32(uint32(h * 2))
	w16(1); w16(32); w32(0); w32(0); w32(0); w32(0); w32(0); w32(0)
	buf.Write(xor)
	buf.Write(and)
	return buf.Bytes()
}
