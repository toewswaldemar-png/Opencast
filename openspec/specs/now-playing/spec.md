# now-playing Specification

## Purpose
Die Liedanzeige ("Now Playing") einer Stream-Karte: Der Bediener trägt Titel und Interpret ein,
Opencast übermittelt den Text als Metadaten an den Icecast-Mount, damit Hörer ihn im Player sehen.
Ist-Stand (geprüft gegen `frontend/src/components/StreamCard.tsx`, `server/internal/api/server.go`,
`server/internal/ingest/relay.go`, `server/internal/icecast/client.go`).

## Requirements

### Requirement: Titeleingabe nur bei laufendem Stream
Die Stream-Karte SHALL ein editierbares Textfeld für die Liedanzeige nur anzeigen, wenn der Stream live ist
(`status.running && status.connected`). Andernfalls SHALL sie den zuletzt eingegebenen Titel als reinen Text
anzeigen, bzw. den Platzhalter "Kein Titel · Unbekannt", wenn keiner gesetzt ist.

#### Scenario: Stream ist live
- **WHEN** der Stream live ist
- **THEN** zeigt die Karte ein Eingabefeld mit Platzhalter "Titel · Interpret"

#### Scenario: Stream ist offline
- **WHEN** der Stream nicht live ist und kein Titel gesetzt wurde
- **THEN** zeigt die Karte "Kein Titel · Unbekannt" als nicht editierbaren Text

### Requirement: Entprellte Übermittlung bei Eingabe
Das Frontend SHALL Titeländerungen 800 ms nach der letzten Eingabe per `POST /api/stream/metadata`
mit `{ "streamId": <id>, "title": <text> }` an den Server senden. Eine noch ausstehende Übermittlung
SHALL durch jede weitere Eingabe ersetzt werden.

#### Scenario: Schnelles Tippen
- **WHEN** der Bediener mehrere Zeichen innerhalb von 800 ms eingibt
- **THEN** wird genau eine Anfrage mit dem Endtext gesendet

### Requirement: Titel wird beim Live-Gehen erneut gesendet
Wechselt der Stream von nicht-live zu live und ist ein Titel gesetzt, SHALL das Frontend den Titel sofort
einmal senden (deckt Stream-Start und Icecast-Reconnect ab, bei dem der Mount die Metadaten verliert).

#### Scenario: Reconnect
- **WHEN** der Status von `reconnecting` zurück auf `connected` wechselt und ein Titel gesetzt ist
- **THEN** wird der Titel erneut gesendet

### Requirement: Server leitet Titel nur an aktive Streams weiter
Der Server SHALL `POST /api/stream/metadata` nur für Streams annehmen, die aktiv zu Icecast relayen.
Für nicht aktive Streams SHALL er einen Fehler zurückgeben und nichts an Icecast senden.

#### Scenario: Unbekannter oder inaktiver Stream
- **WHEN** die `streamId` keinem aktiven Relay entspricht
- **THEN** antwortet der Server mit HTTP 400 und der Meldung `stream "<id>" not active`

### Requirement: Icecast-Metadaten-Update
Der Server SHALL den Titel per `GET /admin/metadata?mode=updinfo&mount=<mount>&song=<titel>` an Icecast senden,
mit Basic-Auth (Source-Benutzer, Default `source`, und Source-Passwort), URL-kodiertem Titel,
`https` bei aktivem SSL und einem Timeout von 5 s. HTTP-Status >= 400 SHALL als Fehler gelten.

#### Scenario: Erfolgreiches Update
- **WHEN** Icecast mit 200 antwortet
- **THEN** antwortet der Server dem Frontend mit `{"status":"ok"}`

#### Scenario: Icecast lehnt ab
- **WHEN** Icecast mit HTTP >= 400 antwortet
- **THEN** wird ein Fehler `metadata update: HTTP <code>` zurückgegeben
