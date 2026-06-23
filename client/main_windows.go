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

	// One monitor capturer per device; multiple cards can subscribe to the same device.
	deviceMonitor   = make(map[string]*stream.Monitor) // deviceId → capturer
	deviceSubs      = make(map[string]map[string]bool)  // deviceId → {monitorId …}
	monitorToDevice = make(map[string]string)            // monitorId → deviceId
	monitorsMu      sync.Mutex

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
	ctx, cancelCtx := context.WithCancel(context.Background())

	ws = wsclient.New(cfg.ServerURL, wsclient.Handlers{
		OnStart: func(p wsclient.CmdStartPayload) {
			go func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[stream/%s] PANIC in handleStart: %v", p.StreamID, r)
						if ws != nil {
							ws.SendError(p.StreamID, fmt.Sprintf("client panic: %v", r))
						}
					}
				}()
				handleStart(p)
			}()
		},
		OnStop: func(p wsclient.CmdStopPayload) {
			go manager.Stop(p.StreamID)
		},
		OnMonitorStart: func(p wsclient.CmdMonitorPayload) {
			go func() {
				// Don't monitor a card that is already streaming.
				if manager.IsStreamRunning(p.MonitorID) {
					return
				}
				// ASIO is exclusive: skip if a running stream already holds the device.
				if strings.HasPrefix(p.DeviceID, "asio:") && manager.IsDeviceInUse(p.DeviceID) {
					return
				}

				monitorsMu.Lock()

				// If this card was previously subscribed to a different device, clean that up.
				if oldDev := monitorToDevice[p.MonitorID]; oldDev != "" && oldDev != p.DeviceID {
					delete(monitorToDevice, p.MonitorID)
					delete(deviceSubs[oldDev], p.MonitorID)
					// If no cards remain for the old device, remove and stop its monitor.
					if len(deviceSubs[oldDev]) == 0 {
						delete(deviceSubs, oldDev)
						if m := deviceMonitor[oldDev]; m != nil {
							delete(deviceMonitor, oldDev)
							monitorsMu.Unlock()
							m.Stop() // released lock first to avoid deadlock with level callback
							monitorsMu.Lock()
						}
					}
				}

				// Subscribe this card to the target device.
				if deviceSubs[p.DeviceID] == nil {
					deviceSubs[p.DeviceID] = make(map[string]bool)
				}
				deviceSubs[p.DeviceID][p.MonitorID] = true
				monitorToDevice[p.MonitorID] = p.DeviceID

				// Create the device monitor if it does not yet exist.
				mon := deviceMonitor[p.DeviceID]
				if mon == nil {
					mon = stream.NewMonitor()
					dev := p.DeviceID
					mon.SetLevelCallback(func(lvl audio.LevelUpdate) {
						// Fan-out to all cards currently subscribed to this device.
						monitorsMu.Lock()
						ids := make([]string, 0, len(deviceSubs[dev]))
						for id := range deviceSubs[dev] {
							ids = append(ids, id)
						}
						monitorsMu.Unlock()
						for _, id := range ids {
							if ws != nil {
								ws.SendMonitorLevel(id, lvl)
							}
						}
					})
					deviceMonitor[p.DeviceID] = mon
				}
				monitorsMu.Unlock()

				log.Printf("[monitor/%s] cmd:monitor:start — device=%s sr=%d ch=%d",
					p.MonitorID, p.DeviceID, p.SampleRate, p.Channels)
				if err := mon.Start(stream.MonitorConfig{
					DeviceID:   p.DeviceID,
					SampleRate: p.SampleRate,
					Channels:   p.Channels,
				}); err != nil {
					log.Printf("[monitor/%s] Start fehlgeschlagen (device=%s): %v", p.MonitorID, p.DeviceID, err)
					if ws != nil {
						ws.SendError("monitor:"+p.MonitorID, err.Error())
					}
				} else {
					log.Printf("[monitor/%s] Monitor läuft: device=%s", p.MonitorID, p.DeviceID)
				}
			}()
		},
		OnMonitorStop: func() {
			stopAllMonitors()
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
	manager.SetErrorCallback(func(streamID, errMsg string) {
		if ws != nil {
			ws.SendError(streamID, errMsg)
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
			cancelCtx()
			manager.StopAll()
			stopAllMonitors()
			systray.Quit()
			return
		}
	}
}

func onExit() {
	manager.StopAll()
	stopAllMonitors()
}

func stopAllMonitors() {
	monitorsMu.Lock()
	toStop := make([]*stream.Monitor, 0, len(deviceMonitor))
	for dev, m := range deviceMonitor {
		toStop = append(toStop, m)
		delete(deviceMonitor, dev)
	}
	for dev := range deviceSubs { delete(deviceSubs, dev) }
	for mid := range monitorToDevice { delete(monitorToDevice, mid) }
	monitorsMu.Unlock()
	for _, m := range toStop {
		m.Stop()
	}
}

func handleStart(p wsclient.CmdStartPayload) {
	log.Printf("[stream/%s] cmd:start empfangen — device=%s format=%s br=%d sr=%d ch=%d",
		p.StreamID, p.DeviceID, p.Format, p.Bitrate, p.SampleRate, p.Channels)

	// ASIO is exclusive per driver instance.  Opening a second capturer for the same
	// device while another stream already holds it crashes the ASIO driver in CGo.
	// Return an error early and leave any running monitor intact.
	if strings.HasPrefix(p.DeviceID, "asio:") && manager.IsDeviceInUse(p.DeviceID) {
		log.Printf("[stream/%s] ASIO-Gerät %s wird bereits von einem laufenden Stream verwendet", p.StreamID, p.DeviceID)
		if ws != nil {
			ws.SendError(p.StreamID, "ASIO-Gerät wird bereits von einem anderen Stream verwendet")
		}
		return
	}

	// Unsubscribe this card from its device monitor.
	// Stop the device monitor only if this was the last subscriber.
	monitorsMu.Lock()
	devID := monitorToDevice[p.StreamID]
	var monToStop *stream.Monitor
	if devID != "" {
		delete(monitorToDevice, p.StreamID)
		delete(deviceSubs[devID], p.StreamID)
		if len(deviceSubs[devID]) == 0 {
			delete(deviceSubs, devID)
			monToStop = deviceMonitor[devID]
			delete(deviceMonitor, devID)
		}
	}
	monitorsMu.Unlock()
	if monToStop != nil {
		log.Printf("[stream/%s] letzter Subscriber — Monitor für %s wird gestoppt", p.StreamID, devID)
		monToStop.Stop()
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

// generateIcon returns a 16x16 solid-orange Windows .ico file in memory.
// The systray library calls CreateIconFromResourceEx which requires ICO format, not PNG.
func generateIcon() []byte {
	const (
		w, h = 16, 16
	)

	// XOR (color) mask: 32 bpp BGRA, rows stored bottom-up
	xor := make([]byte, w*h*4)
	for i := 0; i < w*h; i++ {
		xor[i*4+0] = 0x00 // B
		xor[i*4+1] = 0x6B // G = 107
		xor[i*4+2] = 0xFF // R = 255
		xor[i*4+3] = 0xFF // A = fully opaque
	}

	// AND mask: 1 bpp, DWORD-aligned rows, all zeros = fully visible
	const andStride = 4 // ceil(16/32)*4
	and := make([]byte, h*andStride)

	dibSize := uint32(40 + len(xor) + len(and))

	var buf bytes.Buffer
	w16 := func(v uint16) { buf.WriteByte(byte(v)); buf.WriteByte(byte(v >> 8)) }
	w32 := func(v uint32) {
		buf.WriteByte(byte(v)); buf.WriteByte(byte(v >> 8))
		buf.WriteByte(byte(v >> 16)); buf.WriteByte(byte(v >> 24))
	}

	// ICO file header (6 bytes)
	w16(0); w16(1); w16(1) // reserved, type=ICO, count=1

	// Directory entry (16 bytes)
	buf.WriteByte(w); buf.WriteByte(h); buf.WriteByte(0); buf.WriteByte(0)
	w16(1); w16(32)   // planes, bit-count
	w32(dibSize); w32(22) // size, offset (6+16)

	// BITMAPINFOHEADER (40 bytes) — biHeight is doubled to include the AND mask
	w32(40); w32(uint32(w)); w32(uint32(h * 2))
	w16(1); w16(32); w32(0); w32(0); w32(0); w32(0); w32(0); w32(0)

	buf.Write(xor)
	buf.Write(and)
	return buf.Bytes()
}
