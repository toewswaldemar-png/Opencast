# Proposal

## Why

Nachgewiesen (Tests S-2, S-3, R-1, C-1): CRLF in Name, Beschreibung, Genre, URL oder Mountpunkt landet ungefiltert im Request an Icecast (Header-Injektion). `UseSSL=true` ändert nichts an der Source-Verbindung; Zugangsdaten und Audio laufen im Klartext. Der Icecast-Client hat Data Races zwischen `Connect`, `Write`, `Disconnect` und der Drain-Goroutine. Gleichzeitige `Unregister`-Aufrufe können `close of closed channel` auslösen; aus dem Client-WebSocket-Pfad (`stream:error`) wäre das ein Absturz des Servers.

## What Changes

- Steuerzeichen in allen in Header übernommenen Werten werden abgelehnt oder entfernt.
- Bei `UseSSL=true` wird die Source-Verbindung per TLS aufgebaut.
- Der Icecast-Client wird nebenläufigkeitssicher.
- `Unregister` ist idempotent und gleichzeitig aufrufbar.
- Ziel-Hosts sind optional auf eine Allowlist beschränkbar.

## Capabilities

### New Capabilities


### Modified Capabilities
- `icecast-source`: Header-Bereinigung, TLS, Thread-Sicherheit, Zielbeschränkung.
- `ingest-relay`: idempotenter Stopp.

## Impact

`server/internal/icecast/client.go`, `server/internal/ingest/relay.go`, `server/internal/api/server.go` (Validierung). Reproduktion: `specs/005-opencast-full-review/repro/run.sh`.
