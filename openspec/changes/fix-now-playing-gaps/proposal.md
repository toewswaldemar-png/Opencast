## Why

Die Prüfung der Liedanzeige gegen den Quellcode (siehe `report.md`) hat Fehler und Lücken ergeben:
Titel mit Umlauten können beim Hörer verfälscht ankommen, Mountpoints ohne führenden `/` schlagen still fehl,
der Titel geht beim Wechsel in die Einstellungen verloren, und Fehler beim Übermitteln sind für den Bediener unsichtbar.

## What Changes

- Mountpoint wird für das Metadaten-Update wie beim Verbinden normalisiert (führender `/`).
- Titel wird mit `charset=UTF-8` an Icecast übermittelt.
- Der eingegebene Titel überlebt den Wechsel zwischen Karten- und Einstellungsansicht.
- Fehlschläge der Titelübermittlung werden in der Karte angezeigt; Übermittlung beim Live-Gehen wird bei Fehlschlag wiederholt.
- Server validiert Anfragen (leere `streamId`, Länge, Body-Größe) und liefert differenzierte Statuscodes.
- Shoutcast-Protokoll und OGG-Format: definiertes Verhalten statt stillem Nicht-Funktionieren.
- `Makefile` baut das aktuelle `server/` statt des veralteten `backend/`.
- Tests für Handler, Relay-Weiterleitung und Icecast-Client.

## Capabilities

### Modified Capabilities
- `now-playing`: neue Anforderungen an Normalisierung, Kodierung, Persistenz im UI, Fehleranzeige, Validierung und Protokoll-/Formatgrenzen.

## Impact

- `frontend/src/components/StreamCard.tsx`, `frontend/src/App.tsx` (State anheben)
- `server/internal/api/server.go`, `server/internal/ingest/relay.go`, `server/internal/icecast/client.go`
- `Makefile`, `backend/` (veraltet, ohne Liedanzeige)
- Neue Tests unter `server/internal/...`
