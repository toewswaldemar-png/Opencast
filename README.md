# Opencast

Windows-Audiostreaming-Anwendung: nimmt Audio von WASAPI- oder ASIO-Geräten auf und streamt es per FFmpeg zu einem Icecast-Server.

```
[Audiogerät] → [Windows-Client: WASAPI/ASIO]
                    ↓ HTTP PUT /ingest/{streamId}
              [Server: FFmpeg → Icecast]
                    ↓ WebSocket
              [Web-UI: Status, Steuerung, VU-Meter]
```

**Komponenten**
- **Server** — Go-HTTP-Server mit REST-API, WebSocket-Hub, FFmpeg-Management
- **Client** — Go-Windows-Client, liest Audio per WASAPI oder ASIO (CGO), sendet PCM an den Server
- **Frontend** — React/Vite Web-UI

---

## Server per Docker (Unraid / Linux)

### Voraussetzungen
- Docker + Docker Compose
- Icecast-Server erreichbar im Netzwerk

### Starten

```bash
docker compose up -d
```

Die Web-UI ist danach unter `http://<host>:8765` erreichbar.

### Konfiguration

| Umgebungsvariable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `8765` | HTTP-Port des Servers |
| `BASE_URL` | `http://localhost:8765` | Externe URL (für CORS, Links) |

Konfigurationsdatei (Icecast-Verbindungen, Encoder-Profile) wird unter `/config/Opencast/server.json` gespeichert — das Volume `./data/config` auf dem Host hält die Einstellungen persistent.

### Unraid

Im Docker-Tab manuell anlegen oder per **Compose Manager** (Community Applications):

| Feld | Wert |
|---|---|
| Image | `ghcr.io/toewswaldemar-png/opencast:main` |
| Port | `8765 → 8765` |
| Volume | `/mnt/user/appdata/opencast/config → /config` |
| Env | `PORT=8765` |

---

## Windows-Client

Den Windows-Client (`opencast-client.exe` oder `opencast-client-asio.exe`) auf dem Rechner mit dem Audiogerät ausführen. Er verbindet sich automatisch mit dem Server per WebSocket und wartet auf Steuerkommandos aus der Web-UI.

### ASIO (ReaRoute, ASIO4ALL etc.)

```bash
opencast-client-asio.exe
```

REAPER muss laufen und als ASIO-Host aktiv sein, wenn ReaRoute verwendet wird.

### WASAPI

```bash
opencast-client.exe
```

---

## Build

```bash
# Server
cd server && go build -o opencast-server.exe .

# Client (WASAPI)
cd client && go build -o opencast-client.exe .

# Client (ASIO) — benötigt ASIO SDK in ../ASIOSDK/
cd client && go build -tags asio -o opencast-client-asio.exe .
```

Releases mit vorkompilierten Binaries für Windows und Linux sind unter [Releases](../../releases) verfügbar.
