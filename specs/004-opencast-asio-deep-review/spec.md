# Feature Specification: Opencast-ASIO — Tiefenprüfung mit reproduzierbaren Tests

**Feature Branch**: `004-opencast-asio-deep-review` (Arbeitsbranch: `claude/tender-cerf-aghk3j`)
**Created**: 2026-10-03
**Status**: Draft
**Input**: "Prüfe detailliert mit Speckit die ASIO-Implementierung in Opencast"
**Baut auf**: `001` (Verhalten), `002` (offizielle Spec), `003` (Ardour/PortAudio). Findings F-01…F-21 stehen dort; hier ab F-22.

## Ziel
Die ersten drei Runden haben den Code gelesen und gegen Spec und Referenz-Hosts verglichen. Diese Runde **führt Code aus**:
Der Hub (`client/internal/hub`) läuft unter Linux per `go test -overlay` mit echtem Hub-Code, einem Bridge-Nachbau und Race-Detector.
Dazu kommen die bisher nicht gelesenen Teile: Registry, Tray/Panel, Kommandopfad, StreamSession/Takt, Server-API.

## User Scenarios & Testing

### User Story 1 - Befunde sind reproduzierbar (Priority: P1)
Ich will jeden wichtigen Befund selbst nachvollziehen können, ohne Windows und ASIO-Hardware.

**Independent Test**: `specs/004-opencast-asio-deep-review/repro/run.sh` läuft unter Linux und zeigt Basislinie, Befund-Tests und Drift-Simulation.

**Acceptance Scenarios**:
1. **Given** ein frischer Checkout, **When** `repro/run.sh` läuft, **Then** bestehen die bisherigen Hub-/Buffer-/Session-Tests (Basislinie) mit `-race`.
2. **Given** F-01 und F-23, **When** die Tiefenprüfung läuft, **Then** schlagen die zugehörigen Tests mit nachvollziehbarer Ausgabe fehl.
3. **Given** F-22, **When** die Simulation läuft, **Then** liefert sie Underruns/Overflows pro Stunde je Drift und Puffergröße.

### User Story 2 - Mehrere Kanalpaare gleichzeitig laufen korrekt (Priority: P1)
Stream und Monitore auf verschiedenen Kanalpaaren desselben Geräts (typisch ReaRoute) bleiben beim Starten und Beenden einzelner Karten korrekt zugeordnet.

**Acceptance Scenarios**:
1. **Given** Monitor A (Kanal 1/2) und Stream B (Kanal 3/4), **When** A beendet wird, **Then** hört B weiterhin Kanal 3/4.
2. **Given** Stream läuft, **When** ein Monitor auf Kanal 5/6 startet, **Then** unterbricht der Stream nicht (kein Capturer-Neustart).

### User Story 3 - Gleichmäßiger Stream über Stunden (Priority: P2)
Der Stream läuft auch bei leicht abweichenden Taktgebern von Interface und PC ohne regelmäßige Aussetzer.

**Acceptance Scenarios**:
1. **Given** ±100 ppm Taktabweichung, **When** 1 h gestreamt wird, **Then** höchstens 2 Glitches (Underruns + Overflows).
2. **Given** Start, **When** die ersten 2 s laufen, **Then** höchstens 1 Underrun.

### User Story 4 - Befehle von außen sind abgesichert (Priority: P1, Sicherheit)
Nur gültige, bekannte ASIO-Geräte können über API/WebSocket angesprochen werden.

**Acceptance Scenarios**:
1. **Given** ein Befehl mit beliebiger `deviceId`, **When** er den Client erreicht, **Then** wird er abgelehnt, wenn die ID nicht in der letzten Geräteliste steht.
2. **Given** kein/ungültiges Token, **When** `/api/*` oder `/ws/client` aufgerufen wird, **Then** 401.

### User Story 5 - Robuster Tray/Panel-Pfad (Priority: P3)
Der Tray-Eintrag "ASIO Panel" öffnet das Panel des gewählten Geräts und stört keine laufende Aufnahme.

## Requirements

### Functional Requirements
- **FR-401**: Subscriber-Positionen beziehen sich stets auf die tatsächlich geöffnete Kanalfolge des laufenden Capturers (`capChs`), nicht auf die gewünschte Union (`openChs`).
- **FR-402**: Das Hinzufügen oder Entfernen eines Subscribers unterbricht einen laufenden Stream nicht durch einen Capturer-Neustart (oder die Unterbrechung ist ausdrücklich begrenzt und gemeldet).
- **FR-403**: Zwischen ASIO-Takt (Producer) und StreamSession-Takt (Consumer) gibt es eine Pufferstandsregelung (Zielstand, Vorfüllung), die Taktabweichungen bis ±200 ppm ohne hörbare Lücken ausgleicht.
- **FR-404**: Die Kanalzahl reist mit dem Puffer vom Capturer zum Hub (kein Raten über `h.nativeCh`); Längenabweichung führt zu Verwerfen des Puffers, nie zu einem Panic.
- **FR-405**: Jeder Go-Callback, der vom Treiberthread aus läuft, fängt Panics ab (`recover`), zählt und loggt sie.
- **FR-406**: Der Tray-Pfad nutzt denselben Panel-Ablauf wie `cmd:asio:panel` (Capture stoppen, Gerät wählen, danach neu öffnen).
- **FR-407**: `deviceId` aus Befehlen wird gegen die zuletzt enumerierten ASIO-/WASAPI-IDs geprüft, bevor ein COM-Objekt erzeugt wird.
- **FR-408**: `/api/*`, `/ws` und `/ws/client` verlangen ein Token (vorhandene `WithAuth`-Middleware); CORS und WebSocket-Origin sind eingeschränkt oder konfigurierbar.
- **FR-409**: Die Geräteliste wird nicht synchron im Verbindungsaufbau erzeugt; Heartbeat und Read-Loop starten vorher.
- **FR-410**: Der automatische ffmpeg-Download verifiziert eine feste Version per SHA-256 oder ist abschaltbar.
- **FR-411**: Die Hub-Logik ist plattformunabhängig testbar (kein `//go:build windows` an `hub`, `registry`, ffmpeg-Resolver), CI führt `go test ./...` unter Linux aus.

### Key Entities
- **Hub** (`hub.go`): Subscriber-Map, `openChs` (gewünscht), `capChs` (tatsächlich), `nativeCh`.
- **PCMBuffer** (Kapazität 50 Frames à 1024 Byte ≈ 267 ms) und **Session-Ticker** (Wanduhr).
- **Bridge-Mock** (Test): bildet `goAsioBufferCallback` nach.

## Success Criteria
- **SC-401**: `repro/run.sh` zeigt nach den Fixes keine Fehlschläge (F-01, F-23 grün).
- **SC-402**: Drift-Simulation ≤ 2 Glitches/h bei ±100 ppm, 256/512/2048-Puffer.
- **SC-403**: 5 von 5 Läufen des Race-Stress ohne `DATA RACE` und ohne Panic.
- **SC-404**: Ein Test belegt, dass unbekannte `deviceId` abgelehnt wird.

## Assumptions
- Der Bridge-Mock ist ein **Nachbau** (von Hand) der Logik in `asio_bridge.go:63-79`; der echte cgo-Code wurde nicht ausgeführt.
- Die Drift-Simulation nutzt angenommene Jitterwerte (Consumer ±1 ms, Producer ±0,3 ms) und virtuelle Zeit; reale Werte sind hardware- und systemabhängig.
- Die Annahme "nach `ASIOStop` kommt kein Callback mehr" folgt der Spec; sie wird von PortAudio für manche Treiber nicht geteilt (siehe F-21).
