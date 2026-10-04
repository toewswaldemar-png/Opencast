# Proposal

## Why

Der Server sendet dem Client immer eine vollständige Ingest-URL aus `BASE_URL` (Standard `http://localhost:<PORT>`). Im typischen Aufbau (Server in Docker/Unraid, Client auf Windows) zeigt `localhost` auf den Windows-Rechner selbst; ohne gesetztes `BASE_URL` (in `docker-compose.yml` auskommentiert) scheitert der erste Stream. Der Client kennt die Server-URL aber bereits (`BuildIngestURL(cfg.ServerURL, …)` ist als Fallback vorhanden). README und Image weichen vom Code ab: Das README nennt "FFmpeg → Icecast" im Server, das Image installiert ffmpeg, der Server nutzt es nicht; das README nennt `BASE_URL` "für CORS", tatsächlich wird es nur für die Ingest-URL genutzt; `server/Dockerfile` ist veraltet (kopiert `frontend/dist`); der Container läuft als root.

## What Changes

- Ist `BASE_URL` nicht gesetzt, sendet der Server keine Ingest-URL; der Client baut sie aus der eigenen Server-URL.
- Image ohne ffmpeg und als unprivilegierter Benutzer; veraltetes `server/Dockerfile` entfernen.
- README korrigieren (Architektur, `BASE_URL`, Konfigurationsdatei, Token).

## Capabilities

### New Capabilities


### Modified Capabilities
- `stream-control`: Ingest-URL ohne `BASE_URL`.
- `packaging-release`: schlankes, unprivilegiertes Image; konsistente Dokumentation.

## Impact

`server/main.go`, `server/internal/api/server.go`, `client/main_windows.go`, `Dockerfile`, `server/Dockerfile`, `docker-compose.yml`, `README.md`.
