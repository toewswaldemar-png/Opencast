# Feature Specification: Ardours ASIO-Umsetzung prüfen und Lehren für Opencast ziehen

**Feature Branch**: `003-ardour-asio-review` (Arbeitsbranch: `claude/tender-cerf-aghk3j`)
**Created**: 2026-10-03
**Status**: Draft
**Input**: "Prüfe mit Speckit die ASIO-Implementierung in Ardour gründlich"
**Normative Referenz**: wie in `002` (Steinberg ASIO SDK 2.3, Documentation Release #4). Quellen: [research.md](./research.md).

## Befund vorab: Ardour hat keine eigene ASIO-Schicht
Ardour (DAW, GPL) spricht ASIO ausschließlich über **PortAudios ASIO-Host-API**. Der Ardour-eigene Code
(`libs/backends/portaudio/`) ist ein dünner Adapter (`PaAsio_ShowControlPanel`, `PaAsio_GetAvailableBufferSizes`,
`PaAsio_GetInputChannelName`); der eigentliche ASIO-Host steckt in `PortAudio/src/hostapi/asio/pa_asio.cpp` (4233 Zeilen).
Geprüft wurden daher **beide** Schichten: Ardour (`f39f9d8`, 2026-10-04) und PortAudio (`873e3c8`, 2026-10-02).

## User Scenarios & Testing

### User Story 1 - Konformität des Referenz-Hosts bewerten (Priority: P1)
Ich will wissen, ob Ardours/PortAudios ASIO-Host die offizielle Spezifikation einhält und wo nicht.

**Independent Test**: Konformitätsmatrix pro Spec-Stelle mit Fundstelle (Datei:Zeile) in beiden Repos.

**Acceptance Scenarios**:
1. **Given** die ASIO-2.3-Spezifikation, **When** `pa_asio.cpp` geprüft wird, **Then** liegt je Anforderung ein belegtes Urteil ✔/⚠/✗ vor.
2. **Given** ein Befund, **When** er dokumentiert wird, **Then** unterscheidet der Bericht klar Ardour-Code von PortAudio-Code.

### User Story 2 - Übertragbare Lehren für Opencast (Priority: P1)
Ich will wissen, was Opencast aus dem bewährten Host übernehmen soll und was nicht.

**Acceptance Scenarios**:
1. **Given** ein Muster in PortAudio/Ardour, **When** es auf einen offenen Opencast-Befund (F-xx aus 001/002) passt, **Then** verweist die Lehre auf den Befund und einen Task.
2. **Given** ein Muster, das selbst von der Spec abweicht (z. B. ignorierter Reset-Request), **When** es auffällt, **Then** wird ausdrücklich **nicht** zur Übernahme empfohlen.

### User Story 3 - Unterschiede im Einsatzzweck sind berücksichtigt (Priority: P2)
Ardour ist ein Vollduplex-DAW-Host, Opencast ein Capture-only-Streaming-Client. Empfehlungen berücksichtigen das.

## Requirements

### Functional Requirements
- **FR-301**: Der Bericht trennt Ardour-Code (`libs/backends/portaudio/*`, `gtk2_ardour/engine_dialog.cc`, `tools/x-win/*`) von PortAudio-Code (`src/hostapi/asio/pa_asio.cpp`).
- **FR-302**: Jede Bewertung nennt die Spec-Stelle und mindestens eine Fundstelle mit Zeile und Commit.
- **FR-303**: Jede Lehre für Opencast verweist auf einen Befund (F-xx) oder legt einen neuen an; Muster mit Spec-Abweichung sind als "nicht übernehmen" markiert.
- **FR-304**: Unterschiede im Einsatzzweck (Vollduplex vs. Capture, alle Kanäle vs. Auswahl, Callback- vs. Blocking-Modus) werden benannt.
- **FR-305**: Grenzen der Prüfung (nicht kompiliert, keine Hardware, Build-Stack liegt außerhalb des Repos) werden genannt.

### Key Entities
- **Adapter** (`PortAudioIO`, `PortAudioBackend`): Ardour-Schicht.
- **ASIO-Host** (`pa_asio.cpp`): PortAudio-Schicht, hält `openAsioDeviceIndex`, `theAsioStream`, `asioCallbacks_`.

## Success Criteria
- **SC-301**: 100 % der Prüfpunkte aus `002/analysis.md` (Matrix) sind auch für PortAudio/Ardour bewertet.
- **SC-302**: Jede Lehre ist einem Task zugeordnet oder als "nicht übernehmen" begründet.
- **SC-303**: Jede Fundstelle ist mit `git show <commit>:<pfad>` nachprüfbar.

## Assumptions
- "Ardour-Implementierung" meint die in Ardour ausgelieferte Windows-Konfiguration (`--with-backends=…,portaudio` mit `pa_asio.h`).
- Die für offizielle Windows-Builds verwendete PortAudio-Version liegt nicht im Ardour-Repo (externer Build-Stack, `ardour-build-tools`); es wurde PortAudio `master` geprüft.
