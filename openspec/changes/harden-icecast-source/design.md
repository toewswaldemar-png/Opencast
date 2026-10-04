# Design

## Context

Der Source-Handshake wird per `fmt.Sprintf` als Rohtext gebaut. `Client` hält `conn` und `connected` ohne Synchronisation; die Drain-Goroutine liest `c.conn` nach `Disconnect`.

## Goals / Non-Goals

**Goals:**
- Keine Header-Injektion.
- Verschlüsselte Source-Verbindung auf Wunsch.
- `go test -race` sauber.

**Non-Goals:**
- Shoutcast-Protokoll modernisieren; Authentifizierung der Server-API (eigene Änderung `secure-api-access`).

## Decisions

1. **Validierung** in `StartRequest`/`ServerConfig`: `\r`, `\n`, NUL → HTTP 400; Mountpunkt nur `[A-Za-z0-9._~/-]`. Zusätzlich im Handshake escapen, falls Werte aus alten Konfigurationen kommen.
2. **TLS:** `tls.Dial` bei `UseSSL`; Zertifikatsprüfung Standard an, Opt-out über Konfigurationsfeld `insecureSkipVerify` (dokumentiert).
3. **Nebenläufigkeit:** `sync.Mutex` im `Client`; die Drain-Goroutine hält die eigene `net.Conn` lokal (nicht `c.conn`).
4. **Unregister:** `sync.Once` pro `activeStream` für `close(stopCh)`.
5. **Allowlist:** Umgebungsvariable `ICECAST_ALLOWED_HOSTS` (leer = alles erlaubt, zur Abwärtskompatibilität).

## Risks / Trade-offs

- TLS-Server mit selbstsigniertem Zertifikat brauchen das Opt-out.
- Strengere Mountpunkt-Regel kann seltene Pfade ablehnen.
