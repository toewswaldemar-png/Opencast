## ADDED Requirements

### Requirement: Mountpoint-Normalisierung bei Metadaten-Updates
Der Server SHALL den Mountpoint für `/admin/metadata` mit führendem `/` senden, auch wenn er ohne `/` konfiguriert wurde.

#### Scenario: Mountpoint ohne Schrägstrich
- **WHEN** der Mountpoint als `stream` konfiguriert ist
- **THEN** enthält die Anfrage an Icecast `mount=%2Fstream`

### Requirement: UTF-8-Kodierung des Titels
Der Server SHALL dem Metadaten-Update `charset=UTF-8` mitgeben, damit Umlaute und Sonderzeichen beim Hörer korrekt ankommen.

#### Scenario: Titel mit Umlauten
- **WHEN** der Titel "Müller – Lied" lautet
- **THEN** enthält die Anfrage `charset=UTF-8` und den UTF-8-kodierten Titel

### Requirement: Titel überlebt Ansichtswechsel
Das Frontend SHALL den eingegebenen Titel je Stream außerhalb der `StreamCard`-Komponente halten, sodass er beim Wechsel
in die Einstellungsansicht und zurück sowie bei Neumontage der Karte erhalten bleibt, und eine ausstehende
Übermittlung SHALL dabei nicht verworfen werden.

#### Scenario: Wechsel in die Einstellungen
- **WHEN** der Bediener einen Titel eingibt, in die Einstellungen wechselt und zurückkehrt
- **THEN** zeigt die Karte weiterhin den eingegebenen Titel

### Requirement: Sichtbare Fehler bei der Titelübermittlung
Das Frontend SHALL HTTP-Fehlerantworten von `POST /api/stream/metadata` auswerten und dem Bediener in der Karte anzeigen.
Beim Live-Gehen SHALL die Übermittlung bei Fehlschlag mit Backoff wiederholt werden, da der Icecast-Mount unmittelbar
nach dem Verbinden möglicherweise noch nicht bereit ist.

#### Scenario: Icecast lehnt Update ab
- **WHEN** der Server einen Fehlerstatus zurückgibt
- **THEN** zeigt die Karte einen Hinweis "Titel konnte nicht übermittelt werden"

#### Scenario: Mount noch nicht bereit
- **WHEN** das erste Update direkt nach dem Live-Gehen fehlschlägt
- **THEN** wiederholt das Frontend die Übermittlung bis zu dreimal mit Wartezeiten von 1, 2 und 4 s

### Requirement: Validierung und Statuscodes der Metadaten-API
Der Server SHALL `POST /api/stream/metadata` mit leerer `streamId` oder zu großem Body mit HTTP 400 ablehnen,
den Titel trimmen und auf 255 Zeichen begrenzen, für nicht aktive Streams HTTP 404 und bei Icecast-Fehlern HTTP 502 liefern.

#### Scenario: Stream nicht aktiv
- **WHEN** die `streamId` keinem aktiven Relay entspricht
- **THEN** antwortet der Server mit HTTP 404

#### Scenario: Icecast nicht erreichbar
- **WHEN** das Update an Icecast fehlschlägt
- **THEN** antwortet der Server mit HTTP 502

### Requirement: Definiertes Verhalten für Shoutcast und OGG
Für Streams mit Protokoll `shoutcast` SHALL der Server das Shoutcast-Metadaten-Update verwenden oder die Funktion ausdrücklich als nicht unterstützt melden.
Für das Format `ogg` (Metadaten stecken im Stream, nicht im Admin-Update) SHALL das Frontend das Eingabefeld deaktivieren und einen Hinweis zeigen.

#### Scenario: OGG-Stream
- **WHEN** das Format `ogg` ist
- **THEN** ist das Eingabefeld deaktiviert und zeigt einen Hinweis, dass die Liedanzeige für OGG nicht unterstützt wird

### Requirement: Build erzeugt Server mit Liedanzeige
Der Build-Einstieg (`Makefile`) SHALL das aktuelle Verzeichnis `server/` bauen, das die Liedanzeige enthält.

#### Scenario: make build
- **WHEN** `make build` ausgeführt wird
- **THEN** enthält das Ergebnis die Route `POST /api/stream/metadata`
