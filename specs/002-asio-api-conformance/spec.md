# Feature Specification: ASIO-Host-Konformität gegen die offizielle Spezifikation

**Feature Branch**: `002-asio-api-conformance` (Arbeitsbranch: `claude/tender-cerf-aghk3j`)
**Created**: 2026-10-03
**Status**: Draft
**Input**: "Prüfe mit Speckit eine saubere ASIO-Implementierung unter Bezug auf die offizielle API. Recherchiere gründlich."
**Normative Referenz**: Steinberg ASIO SDK 2.3, *Interface Specification*, Documentation Release #4 (© 1997-2025),
`asio.h`, `iasiodrv.h`. Quellen und Praxisbelege: siehe [research.md](./research.md).

Diese Spec ergänzt `001-asio-capture-review` (Verhalten aus Nutzersicht) um die **API-Verträge** des Hosts.
Jede Anforderung nennt die Spec-Stelle.

## User Scenarios & Testing

### User Story 1 - Jedes Interface liefert korrektes Audio (Priority: P1)
Ich nutze ein beliebiges ASIO-Interface (16/24/32 Bit, little-/big-endian, Float) und bekomme den richtigen Pegel.

**Independent Test**: Tabellentest der Konvertierung je `ASIOSampleType` mit Referenzwerten (Vollausschlag ±, 0, −1 LSB).

**Acceptance Scenarios**:
1. **Given** ein Treiber meldet `ASIOSTInt32LSB24`, **When** Vollausschlag anliegt, **Then** ergibt die Konvertierung 32767 (nicht 127).
2. **Given** ein Treiber meldet einen nicht unterstützten Typ (z. B. DSD), **When** der Start erfolgt, **Then** Abbruch mit Meldung inklusive Typnummer.

### User Story 2 - Treiber-Neukonfiguration wird ordnungsgemäß behandelt (Priority: P1)
Ändert der Nutzer im Control-Panel die Puffergröße oder wechselt die Samplerate, läuft die Aufnahme nach kurzer Pause korrekt weiter.

**Acceptance Scenarios**:
1. **Given** laufender Capture, **When** der Treiber `kAsioResetRequest` sendet, **Then** kehrt der Callback sofort mit 1 zurück und der Host führt Stop → Dispose → Release → Init → Start **außerhalb** des Treiber-Callbacks aus.
2. **Given** `sampleRateDidChange` oder `kAsioBufferSizeChange` oder `kAsioResyncRequest`, **When** das Ereignis eintritt, **Then** gleiches Verhalten (JUCE-Praxis, 500 ms Entprellung).
3. **Given** das Control-Panel ist offen, **When** ein Reset-Request kommt, **Then** wird erst nach dem Schließen neu gestartet.

### User Story 3 - Aussetzer sind sichtbar (Priority: P2)
Meldet der Treiber Overloads/Drop-outs, sieht der Nutzer das in Log und UI.

**Acceptance Scenarios**:
1. **Given** der Treiber unterstützt `kAsioCanReportOverload`, **When** `kAsioOverload` eintrifft, **Then** wird ein Zähler erhöht und gelogged (Rate-limitiert).

### User Story 4 - Samplerate ist immer bekannt und korrekt (Priority: P2)
Ob interne oder externe Clock: die dem Encoder übergebene Samplerate ist die tatsächliche.

**Acceptance Scenarios**:
1. **Given** `getSampleRate` liefert `ASE_NoClock`/0 (externe Clock fehlt), **When** Start, **Then** Fehlermeldung "keine Samplerate-Referenz", kein Stream mit geratener Rate.
2. **Given** `setSampleRate` liefert `ASE_InvalidMode` (externe Clock aktiv), **When** Start, **Then** die aktuelle Treiberrate wird verwendet und dem Encoder gemeldet.

### User Story 5 - Gerätesuche gefährdet den Client nicht (Priority: P2)
Ein defekter oder hängender Treiber beim Enumerieren bringt weder den Client zum Absturz noch blockiert er den Start.

### User Story 6 - Lizenz und Markenhinweise sind geklärt (Priority: P1, nicht-technisch)
Das Projekt kann `opencast-client-asio.exe` rechtssicher veröffentlichen.

## Requirements

### Functional Requirements (mit Spec-Stelle)
- **FR-101** (§II.2 Zustandsautomat): Reihenfolge Init → Abfragen → [Set/CanSampleRate] → CreateBuffers → GetChannelInfo → Start; Abbau Stop → DisposeBuffers → Exit (= COM `Release`). *Ist: konform.*
- **FR-102** (§III.6 `asioMessage`, §II.7 Note): `kAsioResetRequest`, `kAsioBufferSizeChange`, `kAsioResyncRequest` und `sampleRateDidChange` MÜSSEN auf einen kontrollierten Neustart abbilden, der **nach** Rückkehr aus dem Treiber-Callback stattfindet. Rückgabewert bei `kAsioResetRequest` immer `1L`.
- **FR-103** (§III.7 Sample Types): Alle PCM-/Float-Typen werden korrekt nach int16 gewandelt: Int16/24/32 LSB+MSB, Int32LSB/MSB16/18/20/24 (rechtsbündig, vorzeichenerweitert), Float32/64 LSB+MSB. Unbekannte Typen (DSD) werden beim Start abgelehnt. Typ wird **je aktivem Kanal** ermittelt.
- **FR-104** (§III.3 `ASIOGetSampleRate`/`SetSampleRate`/`CanSampleRate`): Rückgabecodes werden ausgewertet: `ASE_NoClock`+0 = unbekannt; `ASE_InvalidMode` bei externer Clock; die tatsächliche Rate wird gemeldet.
- **FR-105** (§II.7, §III.5 `ASIOFuture`): `kAsioCanReportOverload` wird abgefragt; `kAsioOverload` wird gezählt/gelogged.
- **FR-106** (§III.4 `ASIOOutputReady`): `outputReady()` wird einmal als Fähigkeit abgefragt (`ASE_OK` → aufrufen); ein davon abweichender Aufruf ist als ReaRoute-Workaround dokumentiert.
- **FR-107** (§IV `AsioDrivers`, "limited to one active driver"): Probe/Open eines Treibers läuft mit Zeitlimit und kann einen Treiber überspringen (Blacklist-Mechanismus, Fehlerstatus pro Gerät).
- **FR-108** (§III.3 `ASIOGetLatencies`-Note "possibly recursively"): Der Callback ist gegen Wiedereintritt abgesichert oder verwendet je Aufruf eigenen Scratch-Puffer.
- **FR-109** (§App. D Windows): Der Host verändert **nie** Thread-Prioritäten der Treiber-Threads. *Ist: konform.*
- **FR-110** (§App. G, 64-Bit): Registry-Enumeration unter `HKLM\SOFTWARE\ASIO` für 64-Bit-Host. *Ist: konform.*
- **FR-111** (COM): `CoInitializeEx` toleriert `RPC_E_CHANGED_MODE` und wird nur bei Erfolg mit `CoUninitialize` balanciert; STA-Thread pumpt Nachrichten.
- **FR-112** (Lizenz): Das Repository enthält eine bewusst gewählte Lizenz (Steinberg ASIO License oder GPLv3) und Markenhinweise; das SDK liegt nicht im Repo.
- **FR-113** (§III.4 `ASIOCreateBuffers`): `numChannels` wird nicht still gekürzt; Abweichung zwischen angefragter und geöffneter Kanalzahl ist ein Fehler.

### Key Entities
- **Treiber-Zustand** (Loaded/Initialized/Prepared/Running) je Capturer-Instanz.
- **Sample-Format-Tabelle**: `ASIOSampleType` → (Bytes/Sample, Endianness, Ausrichtung, Float?).
- **Reset-Ursache**: ResetRequest | BufferSizeChange | Resync | SampleRateChange.

## Success Criteria
- **SC-101**: Konvertierungstest deckt alle 16 PCM-/Float-Typen der Spec ab (100 %).
- **SC-102**: Ein simulierter `kAsioResetRequest` führt innerhalb 1 s zu laufendem Capture, ohne Neustart aus dem Callback-Thread.
- **SC-103**: Overloads sind im Log zählbar.
- **SC-104**: Enumeration von 20 Treibern mit einem hängenden Probe-Treiber dauert ≤ Zeitlimit + 1 s.
- **SC-105**: `LICENSE`-Datei und Markenhinweis vorhanden, Entscheidung dokumentiert.

## Assumptions
- Nutzung nur Aufnahme (keine Output-Kanäle); Spec-Aussagen zu Output-Latenz sind nachrangig.
- Hardwaretests (ReaRoute, UR22mkII, 24-in-32-Interface) erfolgen manuell durch den Maintainer.
- Rechtliche Bewertung der Lizenz ist keine Rechtsberatung; Entscheidung liegt beim Maintainer.
