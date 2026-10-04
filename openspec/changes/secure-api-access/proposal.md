# Proposal

## Why

`WithAuth` ist in `server/` definiert, aber nirgends eingebunden: `/api/*`, `/ws` und `/ws/client` sind offen, CORS ist `*`, WebSocket-Origin wird nicht geprüft. Nachgewiesen (Test S-1): `GET /api/config` liefert das Icecast-Passwort im Klartext, die Datei `server.json` ist `0644`. Über `POST /api/asio/panel`, `cmd:start` und `cmd:monitor:start` erreicht eine beliebige `deviceId` den Client, der daraus eine COM-Klasse erzeugt. Ein zweiter `/ws/client` verdrängt den echten Client. Die `TokenGate`-Komponente im Frontend ist nicht eingebunden; ihr Hinweis "Token im Backend-Terminal" stammt aus dem Altbestand `backend/`.

## What Changes

- Alle Schnittstellen verlangen ein Token (vorhandene `WithAuth`/`TokenAuth`), konfigurierbar über Umgebung/Konfiguration, beim ersten Start erzeugt und im Log ausgegeben.
- CORS und WebSocket-Origin werden auf konfigurierte Origins beschränkt (Standard: gleiche Herkunft).
- `GET /api/config` liefert keine Passwörter; `PUT` mit leerem Passwort behält den gespeicherten Wert; Konfigdatei `0600`.
- Der Client akzeptiert Geräte-IDs nur aus der zuletzt gemeldeten Geräteliste.
- Das Frontend fragt den Token ab und sendet ihn bei API und WebSocket mit.
- Der Ingest-Pfad wird durch ein einmaliges Geheimnis in der Ingest-URL geschützt.

## Capabilities

### New Capabilities
- `access-control`: Authentifizierung und Herkunftsprüfung aller Server-Schnittstellen.

### Modified Capabilities
- `settings-persistence`: Passwörter werden nicht mehr ausgeliefert; Dateirechte.
- `client-connection`: Windows-Client verbindet sich nur mit Token.
- `device-discovery`: Geräte-IDs aus Befehlen werden gegen die Geräteliste geprüft.
- `web-ui`: Zugangscode-Eingabe und Mitsenden des Tokens.

## Impact

Betrifft `server/main.go`, `server/internal/api/*`, `server/internal/config`, `client/internal/wsclient`, `client/main_windows.go`, `client/internal/hub/registry.go`, `frontend/src/lib/api.ts`, `frontend/src/hooks/useWebSocket.ts`, `frontend/src/App.tsx` (TokenGate einbinden). **Breaking:** bestehende Installationen brauchen einen Token in Client-Konfiguration und Browser.
