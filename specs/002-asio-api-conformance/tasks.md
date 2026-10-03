# Tasks: ASIO-Host-Konformität

**Input**: `spec.md`, `plan.md`, `analysis.md`, `research.md`
Legende: `[P]` parallel · `[Fn]` Finding · `[FR]` Requirement · Überschneidung mit Tasks aus `001` ist vermerkt.

## Phase 0: Entscheidung
- [ ] T210 [F-20][FR-112] **Maintainer entscheidet** Lizenzweg (Steinberg ASIO License oder GPLv3). Danach: `LICENSE` anlegen, README-Abschnitt "ASIO" mit Markenhinweis ("ASIO is a trademark and software of Steinberg Media Technologies GmbH"), Release-Job und Secret-Verwendung prüfen. Bei GPLv3: Quelltext-Angebot für Releases sicherstellen.

## Phase 1: Sample-Konvertierung (ersetzt/ergänzt T002, T013, T014 aus 001)
- [ ] T201 [F-02][FR-103] Tabelle `sampleFormat(typ)` in `client/internal/audio/sample.go` (ohne Build-Tag) mit **allen** Typen aus §III.7: Int16/24/32 LSB+MSB, Int32LSB/MSB16/18/20/24 (Shift `bits-16`, rechtsbündig), Float32/64 LSB+MSB; unbekannt → Fehler mit Typnummer.
- [ ] T202 [P][F-02][FR-103] Tabellentest `sample_test.go`: je Typ Vollausschlag ±, 0 und −1 LSB gegen Referenzwerte (z. B. `Int32LSB24`: `0x007FFFFF` → 32767). Testvektoren als Datei `testdata/sample_vectors.json`, die auch ein C++-Selbsttest lesen kann.
- [ ] T211 [F-02][FR-103] `asio_host.cpp`: `asio_sample_to_i16` und `bytesPerFrame`-Zeile aus der Tabelle ableiten; Typ **je Kanal** ermitteln; unbekannte Typen/DSD in `asio_start_capture` mit Fehlermeldung ablehnen.

## Phase 2: Reset und Diagnose
- [ ] T203 [F-03][FR-102] Reset-Zustandsmaschine: `asio_message` (`ResetRequest`, `BufferSizeChange`, `ResyncRequest`) und `asio_sample_rate_changed` setzen `g_resetReason` (atomar); `bufferSwitchTimeInfo` prüft zusätzlich `timeInfo.flags & kSampleRateChanged`. Pump-Schleife wartet 500 ms, beendet sich mit Grund; Go meldet Fehlertext an die UI; **kein Neustart während das Control-Panel offen ist** (`activePanelClsid`). Rückgabe `1L` bei `ResetRequest` bleibt. `kAsioSelectorSupported` um `ResyncRequest` und `Overload` erweitern. Kein `Release`/`Stop` im Callback.
- [ ] T204 [P][F-14][FR-105] `future(kAsioCanReportOverload)` nach `createBuffers`; `kAsioOverload` → atomarer Zähler; Go loggt Zähler (max. 1×/s) und sendet Warnung an die UI.

## Phase 3: Samplerate, Probe
- [ ] T205 [F-15][FR-104] `asio_start_capture`: Rückgabecodes auswerten; `ASE_NoClock`/0 → Fehler "Keine Samplerate-Referenz (externe Clock?)"; `ASE_InvalidMode` bei `setSampleRate` → aktuelle Rate übernehmen. `actualSampleRate == 0` nie auf die angefragte Rate zurückfallen lassen. Test mit Mock-Treiberantwort über eine kleine C-Schnittstelle oder Go-Seite.
- [ ] T206 [F-16][FR-107] `asioProbeDriverSTA`: `select` mit Timeout (z. B. 8 s) → Gerät als "unbekannt/nicht antwortend" markieren; konfigurierbare Blacklist (`ASIO DirectX Full Duplex Driver`, `ASIO Multimedia Driver`, Adobe/Premiere-Wrapper); Test mit hängendem Fake-Probe.

## Phase 4: Restpunkte
- [ ] T207 [P][F-17][FR-106] **Erst messen**: Verhalten von ReaRoute mit/ohne einmaliger `outputReady()`-Abfrage dokumentieren. Danach entweder Probe + Aufruf nur bei `ASE_OK` (Spec/Referenz-Hosts) oder Workaround mit Spec-Verweis im Kommentar und in `CLAUDE.md` belassen.
- [ ] T208 [P][F-18][FR-108] Wiedereintrittsschutz: atomarer Zähler im Callback; bei Wiedereintritt Frame verwerfen und zählen, oder Doppelpuffer.
- [ ] T209 [P][F-19][FR-113] Kanalzahl > 32 als Fehler statt Kürzen; `getBufferSize`-Fehlschlag als Fehler statt Fallback 512; Hub gleicht `nativeCh` mit der vom Capturer gemeldeten Kanalzahl ab (`ActualConfig().NativeChannels`).

## Abhängigkeiten
T210 unabhängig · T201 → T202, T211 · T203 vor T205 (gleiche Pump-Schleife) · T206 unabhängig · T207 nach Hardware-Messung · Tests (T202) vor den Fixes.

## Coverage
FR-101 ✔ konform · FR-102 T203 · FR-103 T201, T202, T211 · FR-104 T205 · FR-105 T204 · FR-106 T207 · FR-107 T206 · FR-108 T208 · FR-109 ✔ konform · FR-110 ✔ konform · FR-111 → T033 aus 001 · FR-112 T210 · FR-113 T209.

## Manuelle Hardware-Abnahme
1. ReaRoute: Reset über Control-Panel, REAPER beenden/starten.
2. UR22mkII: Puffergröße im Panel ändern; USB ziehen.
3. Interface mit 24-in-32-Treiber (`Int32LSB24`): Pegel gegen WASAPI vergleichen (±1 dB).
4. Interface mit externer Clock (S/PDIF): Clock trennen, Start versuchen.
