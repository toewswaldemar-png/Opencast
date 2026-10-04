# ingest-relay Specification

## Purpose
Beschreibt, wie der Server den vom Windows-Client per HTTP PUT gelieferten Audiostrom entgegennimmt und an Icecast weiterleitet.

## Requirements

### Requirement: Ingest nur für registrierte Streams
`PUT /ingest/{streamId}` SHALL nur angenommen werden, wenn der Stream registriert ist; die Registrierung wird dabei verbraucht.

#### Scenario: Unbekannte streamId
- **WHEN** ein PUT für eine nicht registrierte `streamId` eintrifft
- **THEN** antwortet der Server mit HTTP 404

#### Scenario: Registrierte streamId
- **WHEN** ein PUT für eine registrierte `streamId` eintrifft
- **THEN** antwortet der Server sofort mit HTTP 200 und liest den Body fortlaufend

### Requirement: Verzögerte Icecast-Verbindung
Der Server SHALL die Verbindung zu Icecast erst nach dem ersten empfangenen Audio-Chunk aufbauen und diesen Chunk als Erstes senden.

#### Scenario: Erster Chunk
- **WHEN** der erste Chunk eintrifft
- **THEN** verbindet sich der Server mit Icecast, sendet den Chunk und meldet `connected=true`

#### Scenario: Client trennt vor dem ersten Chunk
- **WHEN** der Client trennt, ohne Daten zu senden
- **THEN** wird keine Icecast-Verbindung aufgebaut

### Requirement: Keine Rückstau-Wirkung auf den Client
Der Server SHALL eingehende Daten ohne Blockieren puffern (32 Chunks); ist der Puffer voll, SHALL der Chunk verworfen werden.

#### Scenario: Icecast nicht erreichbar
- **WHEN** der Puffer während einer Wiederverbindung vollläuft
- **THEN** werden weitere Chunks verworfen und der Client wird nicht blockiert

### Requirement: Automatische Wiederverbindung
Ist AutoReconnect aktiv, SHALL der Server bei Schreibfehlern die Icecast-Verbindung mit Wartezeit 1 s beginnend und verdoppelt (1, 2, 4, 8, 16, 32 s) neu aufbauen und den Status `reconnecting` melden.

#### Scenario: Icecast-Verbindung bricht ab
- **WHEN** ein Schreibvorgang fehlschlägt und AutoReconnect aktiv ist
- **THEN** meldet der Server `reconnecting=true` und versucht die Verbindung nach 1 s, 2 s, 4 s … erneut

#### Scenario: AutoReconnect aus
- **WHEN** ein Schreibvorgang fehlschlägt und AutoReconnect inaktiv ist
- **THEN** wird der Stream beendet

### Requirement: Statusmeldungen
Der Server SHALL alle 5 Sekunden Bytes, Laufzeit, Hörerzahl und Bitrate eines aktiven Streams an die Browser melden.

#### Scenario: Aktiver Stream
- **WHEN** ein Stream aktiv ist
- **THEN** erhalten die Browser alle 5 s ein Status-Update mit `bytesSent`, `uptime`, `listeners` und `bitrate`

### Requirement: Stopp beendet den Relay
Ein Stopp SHALL den aktiven Relay beenden, die Icecast-Verbindung schließen und `connected=false` melden.

#### Scenario: Stopp während Reconnect
- **WHEN** ein Stopp eintrifft, während der Server wieder verbindet
- **THEN** wird die Wiederverbindungsschleife abgebrochen
