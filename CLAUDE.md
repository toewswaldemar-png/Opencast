# Opencast — Projektkontext für Claude Code

## Was ist das?

Windows-Audiostreaming-Anwendung: nimmt Audio von WASAPI- oder ASIO-Geräten auf
und streamt es per FFmpeg/Icecast. Besteht aus drei Teilen:

- **`server/`** — Go-HTTP-Server (Gin), REST-API, WebSocket-Hub, FFmpeg-Prozess-Management, Icecast-Ingest
- **`client/`** — Go-Windows-Client, liest Audio (WASAPI oder ASIO via CGO), sendet PCM per WebSocket/HTTP PUT an den Server
- **`frontend/`** (React/Vite) — Web-UI, kommuniziert mit dem Server per REST + WebSocket

## Architektur

```
[Audiogerät] → [client: WASAPI/ASIO capture]
                    ↓ HTTP PUT /ingest/{streamId}
              [server: FFmpeg encode → Icecast]
                    ↓ WebSocket /ws/client
              [client ← Steuerkommandos]
                    ↓ WebSocket /ws/browser
              [Frontend ← Status/Level-Updates]
```

## Build

```bash
# ASIO-Client (ReaRoute etc.)
cd client && go build -tags asio -o opencast-client-asio.exe .

# Standard-Client (WASAPI only)
cd client && go build -o opencast-client.exe .

# Server
cd server && go build -o opencast-server.exe .
```

**WICHTIG**: Der ASIO-Client heißt immer `opencast-client-asio.exe`.

## ASIO-Implementierung (`client/internal/audio/`)

### Globale Synchronisation
- `asioGlobalMu sync.Mutex` — serialisiert ASIO-Treiber-Opens (nur ein Treiber gleichzeitig)
- `globalASIOCapturer atomic.Pointer[ASIOCapturer]` — aktueller Capturer, atomar (kein Mutex im C→Go-Callback-Hotpath)
- `asioEnumerateMu sync.Mutex` — serialisiert Enumeration (Start + Tray-Goroutine laufen parallel)
- `asioChannelCache sync.Map` — CLSID → Kanalzahl-Cache für busy-Driver-Probes

### Kanal-Konfiguration
Kanäle 1-basiert in der UI (channelLeft/channelRight), 0-basiert intern.
Wenn L == R: nur 1 ASIO-Kanal geöffnet, Callback expandiert Mono → Stereo.
Wenn L != R: 2 Kanäle geöffnet.

### CGO-Callback-Optimierung (wichtig, beachten!)
`goAsioBufferCallback` läuft auf dem C-ASIO-Thread (kein Go-Goroutine).
Im Monitor-Modus (kein aktiver Stream):
- Fast path: `hasPCMSpace = len(pcmOut) < cap(pcmOut)` ist false wenn Buffer voll
- `levelDue` ist false wenn < 33ms seit letztem Level-Update
- Wenn beides false → **sofortiger Return, null Allokation**
- Wenn Level fällig → `computeLevelFromC()` liest direkt aus C-Zeiger, kein Go-`make()`

Im Streaming-Modus (Encoder liest pcmOut): `hasPCMSpace = true` → normaler Allokations-Pfad.

`monitor.go run()` liest **nicht** mehr von `OutputCh()` — das wäre 750×/s Goroutine-Wakeup für nix.

### WSAStartup-Problem (gelöst)
Einige ASIO-Treiber rufen `WSACleanup()` in `DLL_PROCESS_DETACH` auf.
Nach 18 Proben (jede mit eigenem COM-Init/Uninit-Zyklus) war der Winsock-Ref-Count 0
→ Crash beim nächsten Socket-Aufruf.
Fix: `WSAStartup(MAKEWORD(2,2), &wsa)` am Anfang von `asio_open_driver()` UND
`asio_probe_driver()` — erhöht Ref-Count, Cleanup-Aufrufe der Treiber können ihn nicht auf 0 bringen.
Include-Reihenfolge: `winsock2.h` VOR `windows.h` (sonst Warning).
Linker: `-lws2_32` in CGO LDFLAGS.

### ASIO-Monitor-Deadlock (gelöst)
Wenn Monitor-Gerät wechselt und neues Gerät auch ASIO ist:
Alter Capturer hält `asioGlobalMu`, neuer `Start()` wartet darauf → Deadlock.
Fix in `monitor.go Start()`: bei ASIO-Gerät erst `stopLocked()` aufrufen, dann neuen Capturer starten.

## WebSocket-Herzschlag (client/internal/wsclient/client.go)
Server setzt 90s Read-Deadline, resettet nur bei TEXT-Frames.
Client sendet alle 30s `"heartbeat"` TEXT-Message → kein Timeout.
Client setzt eigenen 90s Read-Deadline, resettet bei Server-Pings.

## API-Routen (server)

```
GET  /api/devices          — Geräteliste vom Windows-Client
POST /api/stream/start     — Stream starten
POST /api/stream/stop      — Stream stoppen
POST /api/monitor/start    — VU-Monitor starten
POST /api/monitor/stop     — VU-Monitor stoppen
PUT  /ingest/{streamId}    — HTTP PUT Audio-Ingest vom Client
GET  /ws/client            — WebSocket: Windows-Client
GET  /ws/browser           — WebSocket: Frontend
```

## Frontend-Struktur
React + Vite, in `server/dist/` eingebaut.
Kanalauswahl: separate **Links**- und **Rechts**-Dropdowns (1-basiert, 1..maxInputChannels).
`channelLeft`/`channelRight` als `uint16` durch den ganzen Stack (war früher `channels: number`).

## Bekannte Eigenheiten

### ReaRoute ASIO
- REAPER muss laufen und als ASIO-Host aktiv sein, sonst keine Callbacks
- Kanalzahl = Anzahl der in REAPER gerouteten Kanäle (variabel)
- `kAsioSupportsTimeInfo = 1` → Treiber ruft `bufferSwitchTimeInfo` auf (nicht `bufferSwitch`)

### ASIO-Kanal-Probe
`asio_probe_driver()` öffnet kurz den Treiber per COM um Kanalzahl abzufragen.
Wenn Treiber gerade im Monitor/Capture belegt: TryLock schlägt fehl → Cache-Fallback.
Cache wird bei jedem erfolgreichen Open aktualisiert.

### Winsock-Include-Reihenfolge in asio_host.cpp
`#include <winsock2.h>` MUSS vor `#include <windows.h>` stehen.

## Offene Themen / nächste Schritte
- CPU-Last mit ASIO im Monitor-Modus getestet? (War ~22% vor der zero-alloc-Optimierung)
- Streaming-Modus mit ASIO testen (hasPCMSpace=true Pfad)
- Eventuell: `asio_buffer_switch_time_info` ruft `asio_buffer_switch` auf → doppelter CGO-Übergang
  (in asio_host.cpp, nicht kritisch solange CPU stimmt)
