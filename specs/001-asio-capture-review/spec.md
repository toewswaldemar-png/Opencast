# Feature Specification: ASIO-Capture — Soll-Zustand und Konformitätsprüfung

**Feature Branch**: `001-asio-capture-review` (Arbeitsbranch: `claude/tender-cerf-aghk3j`)
**Created**: 2026-10-03
**Status**: Draft
**Input**: "Prüfe mit Speckit eine saubere ASIO-Umsetzung in Opencast"

Diese Spec beschreibt den **Soll-Zustand** der ASIO-Aufnahme im Windows-Client
(`client/internal/audio/`, `client/internal/hub/`). Sie wurde aus `CLAUDE.md` und dem Code
rekonstruiert; die Abweichungen stehen in `analysis.md`.

## User Scenarios & Testing

### User Story 1 - Stereo-/Mono-Stream von ASIO-Kanälen (Priority: P1)
Ich wähle in der UI ein ASIO-Gerät und je einen Links- und Rechts-Kanal (1-basiert) und starte einen Stream.

**Independent Test**: Hub mit Mock-Capturer und echtem Bridge-Puffer; erwartet: Bytes am PCMBuffer == Frames × 4,
Dauer des Streams == Dauer der Aufnahme.

**Acceptance Scenarios**:
1. **Given** L=1, R=2 auf einem 8-Kanal-Gerät, **When** Stream startet, **Then** werden genau Kanäle 0 und 1 geöffnet und L/R korrekt zugeordnet.
2. **Given** L=3, R=3, **When** Stream startet, **Then** wird genau 1 Kanal geöffnet und der Stream ist Dual-Mono mit **unveränderter Dauer** (kein Faktor 2).
3. **Given** L=9 auf einem 8-Kanal-Gerät, **When** Stream startet, **Then** Fehlermeldung "Kanal außerhalb des Bereichs", kein stilles Umbiegen.

### User Story 2 - VU-Monitor ohne Last (Priority: P1)
Ich sehe Pegel eines ASIO-Eingangs, ohne zu streamen.

**Independent Test**: Allokations-/Lock-Messung des Callbacks im Monitor-Modus (`testing.AllocsPerRun`).

**Acceptance Scenarios**:
1. **Given** Monitor aktiv, kein Stream, **When** Callbacks laufen, **Then** pro Buffer ohne fälligen Level 0 Allokationen und kein Lock; Level-Updates ≈ 30/s.
2. **Given** Monitor startet frisch, **When** erster Callback kommt, **Then** erscheint der erste Pegel innerhalb von 100 ms.

### User Story 3 - Geräteliste mit korrekter Kanalzahl (Priority: P2)
Die UI zeigt für jedes ASIO-Gerät die richtige Anzahl Eingangskanäle, auch während ein anderes Gerät aufnimmt.

**Acceptance Scenarios**:
1. **Given** Gerät A nimmt auf, **When** Gerät B erstmals enumeriert wird, **Then** zeigt B seine echte Kanalzahl oder "unbekannt", **nie** einen erfundenen Wert.
2. **Given** Gerät A nimmt auf, **When** Gerät B ebenfalls gestartet wird, **Then** klare Fehlermeldung "ASIO-Treiber belegt" statt hängender UI.

### User Story 4 - Robuster Betrieb (Priority: P2)
Treiber-Reset, Samplerate-Wechsel, Gerät abgezogen oder REAPER nicht gestartet führen zu klarem Status und kontrolliertem Neustart.

**Acceptance Scenarios**:
1. **Given** laufender Capture, **When** der Treiber `kAsioResetRequest` sendet, **Then** wird kontrolliert neu gestartet und die UI informiert.
2. **Given** laufender Capture, **When** 5 s keine Callbacks kommen (nicht nur direkt nach dem Start), **Then** Stall-Erkennung und Neustart.
3. **Given** ReaRoute ohne laufendes REAPER, **When** Start, **Then** Fehlermeldung mit Backoff statt Neustart alle ~8 s ohne Ende.

### User Story 5 - Exotische Sample-Formate (Priority: P3)
Interfaces mit 24-in-32-Bit, Big-Endian oder DSD funktionieren oder werden klar abgelehnt.

## Requirements

### Functional Requirements
- **FR-001**: Discovery MUSS pro Gerät die echte Eingangskanalzahl liefern; bei belegtem Treiber den Cache, sonst "unbekannt" (kein Fallback 32).
- **FR-002**: Zwei ASIO-Geräte gleichzeitig MÜSSEN mit klarer Fehlermeldung abgelehnt werden; `Start()` darf nicht unbegrenzt auf `asioGlobalMu` blockieren (Timeout/ctx).
- **FR-003**: Kanäle außerhalb `1..maxInputChannels` MÜSSEN abgelehnt werden; `openChs` entspricht exakt den geöffneten Kanälen; keine Duplikate.
- **FR-004**: Die Frame-Zahl des an Hub/Encoder gelieferten PCM entspricht der Frame-Zahl des Treibers; der Vertrag von `PCMFanOutCapturer` (Kanalzahl = `len(openChs)`, interleaved int16 LE) gilt auch für 1 Kanal.
- **FR-005**: Monitor-Callback: 0 Allokationen und kein blockierendes Lock ohne fälliges Level. Streaming-Callback: kein blockierendes Lock auf dem Treiberthread.
- **FR-006**: Alle `ASIOSampleType` werden korrekt konvertiert oder beim Start abgelehnt; Typ wird pro Kanal oder mit Prüfung auf Gleichheit bestimmt.
- **FR-007**: `asio_stop` ist an die Capturer-Instanz gebunden; COM-Init/-Uninit balanciert; WSAStartup-Bump bleibt (dokumentiert).
- **FR-008**: `asio_message` behandelt ResetRequest, ResyncRequest, BufferSizeChange, LatenciesChanged; `sampleRateDidChange` wird erkannt; Stall-Erkennung läuft über die gesamte Laufzeit.
- **FR-009**: Das Control-Panel gibt Treiber und Thread nach dem Schließen frei.
- **FR-010**: Auto-Restart nutzt Backoff und Obergrenze; Fehler gehen an die UI.
- **FR-011**: Konvertierungs-, Mapping- und Expansionslogik sind ohne Treiber testbar; CI führt `go vet` und `go test` für den Client aus.
- **FR-012**: `CLAUDE.md` beschreibt den tatsächlichen Code (Hub statt `monitor.go`, Callback-Pfade).

### Key Entities
- **ASIOCapturer** (`capturer_asio.go`): ein Treiber, ein Thread, Callback-Empfänger.
- **Hub** (`hub/hub.go`): ein Capturer pro Gerät, Subscriber (Monitor/Stream), Kanal-Union.
- **Bridge** (`asio_bridge.go`, `asio_host.cpp`): C↔Go, Globals `g_*`.

## Success Criteria
- **SC-001**: Stream mit L==R hat dieselbe Dauer wie die Quelle (Abweichung < 1 %).
- **SC-002**: Monitor-Callback ohne fälliges Level: 0 Allokationen/Aufruf.
- **SC-003**: Kein Gerät zeigt eine erfundene Kanalzahl.
- **SC-004**: Stall (keine Callbacks ≥ 5 s) wird zu jedem Zeitpunkt erkannt.
- **SC-005**: CI führt `go vet ./...` und `go test ./...` unter `GOOS=windows` aus.

## Assumptions
- Windows 10/11, 64-Bit, MinGW, ASIO SDK vorhanden.
- Zielgeräte: ReaRoute, Yamaha/Steinberg USB (UR22mkII), ASIO4ALL u. ä.
- Hardware-Verifikation (echte Treiber) liegt außerhalb dieser Linux-Sitzung.
