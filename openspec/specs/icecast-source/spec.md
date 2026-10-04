# icecast-source Specification

## Purpose
Beschreibt die Source-Verbindung zu Icecast bzw. Shoutcast sowie Metadaten- und Hörerabfragen.

## Requirements

### Requirement: Icecast-2-Handshake
Für das Protokoll `icecast2` SHALL der Server einen `PUT`-Request mit Basic-Authentifizierung, `Content-Type`, `Ice-*`-Metadaten und `Expect: 100-continue` senden und auf `100` oder `200` warten.

#### Scenario: Server akzeptiert
- **WHEN** Icecast mit `100 Continue` antwortet
- **THEN** gilt die Verbindung als aufgebaut

#### Scenario: Server lehnt ab
- **WHEN** Icecast einen anderen Statuscode liefert
- **THEN** schlägt der Verbindungsaufbau mit "server rejected connection" fehl

### Requirement: Shoutcast-Handshake
Für das Protokoll `shoutcast` SHALL der Server `SOURCE <mount> ICE/1.0` mit `ice-password` senden und HTTP 200 erwarten.

#### Scenario: Shoutcast-Quelle
- **WHEN** das Protokoll `shoutcast` konfiguriert ist
- **THEN** wird der SOURCE-Request gesendet

### Requirement: Standardbenutzer und Mountpunkt
Ohne Benutzernamen SHALL `source` verwendet werden; ein Mountpunkt ohne führenden Schrägstrich SHALL ergänzt werden.

#### Scenario: Mount ohne Slash
- **WHEN** der Mountpunkt `live` lautet
- **THEN** verwendet der Server `/live`

### Requirement: IPv4-Bevorzugung
Der Server SHALL bei der Namensauflösung eine IPv4-Adresse bevorzugen.

#### Scenario: localhost
- **WHEN** der Host `localhost` lautet
- **THEN** verbindet sich der Server über IPv4

### Requirement: Antworten leeren
Der Server SHALL serverseitige Antworten nach dem Handshake fortlaufend lesen, damit Icecast kein Source-Timeout auslöst.

#### Scenario: Zweite Antwort
- **WHEN** Icecast nach dem ersten Audioframe `200 OK` sendet
- **THEN** wird diese Antwort gelesen und verworfen

### Requirement: Metadaten und Hörerzahl
Der Server SHALL Titel-Updates über `/admin/metadata` (`mode=updinfo`) senden und die Hörerzahl des Mountpunkts aus `/status-json.xsl` lesen.

#### Scenario: Titel setzen
- **WHEN** `POST /api/stream/metadata` für einen aktiven Stream eintrifft
- **THEN** sendet der Server das Update an Icecast und antwortet mit HTTP 200

#### Scenario: Inaktiver Stream
- **WHEN** der Stream nicht aktiv ist
- **THEN** antwortet der Server mit HTTP 400
