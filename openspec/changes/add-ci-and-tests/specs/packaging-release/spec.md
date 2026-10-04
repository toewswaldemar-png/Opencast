# Spec Delta

## ADDED Requirements

### Requirement: Pull-Request-Prüfung
Jeder Pull Request SHALL `go vet` und `go test -race` für Server und Client-Kernlogik, `tsc --noEmit` und den Frontend-Build sowie die Kompilierung des Windows-Clients (WASAPI) ausführen; der ASIO-Build SHALL in einem eigenen Windows-Job laufen, soweit das SDK-Secret verfügbar ist.

#### Scenario: Fehler im Client
- **WHEN** ein Pull Request einen Kompilierfehler im Windows-Client enthält
- **THEN** schlägt die Prüfung des Pull Requests fehl

### Requirement: Plattformunabhängig testbare Kernlogik
Hub, Registry, Stream-Session und PCM-Puffer SHALL ohne Windows-Build-Tag kompilieren und ihre Tests unter Linux ausführen.

#### Scenario: Linux-Lauf
- **WHEN** `go test ./...` im Verzeichnis `client` unter Linux läuft
- **THEN** werden die Tests von Hub, Session und Puffer ausgeführt

### Requirement: Server-Tests
Der Server SHALL automatisierte Tests für die Szenarien der Spezifikationen `stream-control`, `ingest-relay`, `client-connection`, `browser-realtime`, `level-monitoring` und `settings-persistence` enthalten.

#### Scenario: Szenario aus der Spezifikation
- **WHEN** ein Szenario in einer dieser Spezifikationen steht
- **THEN** existiert ein Test, der es gegen den echten Server-Code ausführt

### Requirement: Reproduzierbare ffmpeg-Beschaffung
Fehlt `ffmpeg`, SHALL der Client eine feste Version laden und deren SHA-256-Prüfsumme prüfen; bei Abweichung SHALL er abbrechen. Der Download SHALL abschaltbar sein.

#### Scenario: Manipulierte Datei
- **WHEN** die Prüfsumme nicht passt
- **THEN** wird die Datei verworfen und nicht ausgeführt

### Requirement: Frontend nicht eingecheckt
Das gebaute Frontend (`server/dist`) SHALL nicht im Repository liegen, sondern von Docker und Release-Workflow aus dem Quelltext gebaut werden.

#### Scenario: Frischer Checkout
- **WHEN** das Repository frisch geklont wird
- **THEN** enthält `server/dist` keine eingecheckten Build-Artefakte
