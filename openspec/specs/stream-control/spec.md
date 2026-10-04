# stream-control Specification

## Purpose
Beschreibt, wie ein Stream über die REST-API gestartet und gestoppt wird und wie der Server den Windows-Client dazu anweist.

## Requirements

### Requirement: Stream starten
Der Server SHALL `POST /api/stream/start` mit einer `streamId` annehmen, den Stream registrieren und dem verbundenen Windows-Client den Befehl `cmd:start` mit Ingest-URL, Format, Bitrate, Samplerate und Kanälen senden.

#### Scenario: Erfolgreicher Start
- **WHEN** ein Windows-Client verbunden ist und die `streamId` noch nicht läuft
- **THEN** antwortet der Server mit HTTP 200 `{"status":"started"}` und sendet `cmd:start` an den Client

#### Scenario: Fehlende streamId
- **WHEN** der Request keine `streamId` enthält
- **THEN** antwortet der Server mit HTTP 400

#### Scenario: Kein Client verbunden
- **WHEN** kein Windows-Client verbunden ist
- **THEN** antwortet der Server mit HTTP 503 und registriert keinen Stream

#### Scenario: Stream läuft bereits
- **WHEN** die `streamId` bereits registriert oder aktiv ist
- **THEN** antwortet der Server mit HTTP 409

### Requirement: Standardwerte beim Start
Fehlende Parameter SHALL durch Standardwerte ersetzt werden: Samplerate 44100, linker Kanal 1, rechter Kanal 2, Bitrate 192 kbps, Format `mp3`.

#### Scenario: Leere Parameter
- **WHEN** der Request nur `streamId` und Serverdaten enthält
- **THEN** sendet der Server `cmd:start` mit 44100 Hz, Kanal 1/2, 192 kbps und `mp3`

### Requirement: Ingest-URL
Der Server SHALL die Ingest-URL des Streams aus der konfigurierten Basis-URL (`BASE_URL`, Standard `http://localhost:<PORT>`) und der `streamId` bilden und dem Client im Befehl mitgeben.

#### Scenario: Basis-URL gesetzt
- **WHEN** `BASE_URL=http://192.168.1.5:8765` gesetzt ist und `streamId=1`
- **THEN** lautet die Ingest-URL `http://192.168.1.5:8765/ingest/1`

### Requirement: Registrierung verfällt ohne Ingest
Ein registrierter Stream SHALL nach 30 Sekunden ohne `PUT /ingest/{streamId}` automatisch entfernt werden, und die Browser SHALL einen Status "nicht verbunden" erhalten.

#### Scenario: Client sendet nicht
- **WHEN** nach `cmd:start` 30 Sekunden lang kein Ingest eintrifft
- **THEN** wird die Registrierung gelöscht und ein Status mit `connected=false` gesendet

### Requirement: Stream stoppen
Der Server SHALL `POST /api/stream/stop` annehmen, den Relay-Stream beenden und dem Client `cmd:stop` senden.

#### Scenario: Stopp
- **WHEN** ein Stopp für eine `streamId` eintrifft
- **THEN** beendet der Server den Relay-Stream, sendet `cmd:stop` und antwortet mit HTTP 200

### Requirement: Fehlschlag beim Senden an den Client
Kann der Befehl nicht an den Client zugestellt werden, SHALL der Server die Registrierung zurücknehmen und HTTP 503 melden.

#### Scenario: Sendepuffer voll
- **WHEN** `cmd:start` nicht in den Sendepuffer des Clients passt
- **THEN** wird der Stream deregistriert und HTTP 503 geliefert
