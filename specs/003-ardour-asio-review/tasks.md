# Tasks: Lehren aus Ardour/PortAudio

**Input**: `spec.md`, `plan.md`, `analysis.md`, `research.md`. Legende: `[Fn]` Opencast-Finding · `[Ln]` Lehre · `[FR]` Requirement.
Tasks aus `001`/`002` sind **nicht** dupliziert, sondern verknüpft.

## Phase 1: Klein und unabhängig
- [ ] T301 [F-21][L-3] `asio_host.cpp`: atomarer In-Flight-Zähler im Callback (`asio_buffer_switch`); in `asio_run_message_pump` nach `stop()` bis zu 2 s warten, bis der Zähler 0 ist, bevor `disposeBuffers()`/`free(g_pcmBuf)`; bei Timeout loggen und Puffer nicht freigeben. `g_numChannels`/`g_bufferSize`/`g_pcmBuf` als atomare Zeiger-/Wertgruppe oder unter dem Zähler schützen.
- [ ] T304 [L-1][F-05] `capturer_asio.go`: `openASIODevice atomic.Pointer[string]`; `Start()` für ein anderes Gerät als das offene → sofort Fehler "ASIO-Treiber belegt durch <Name>" (kein Blockieren auf `asioGlobalMu`). Test mit zwei Mock-Capturern. *Erweitert T021 aus 001.*
- [ ] T305 [L-2][F-04][F-05] `asio_bridge.go`: Während ein Capture läuft, liefert `asioEnumerateDrivers` nur Cache-Werte (`fromCache=true`); ohne Cache `maxInputChannels=0`. Der Fallback "32 Kanäle" entfällt vollständig. Frontend zeigt "Kanalzahl unbekannt". *Konkretisiert T020 aus 001.*

## Phase 2: Muster übernehmen
- [ ] T302 [L-8][F-07] COM-Hilfe nach `PaWinUtil_CoInitialize`: Struktur `{state, initThreadId}`; `RPC_E_CHANGED_MODE` zulassen, dann **nicht** uninitialisieren; `CoUninitialize` nur bei Erfolg und auf demselben Thread, sonst Warnung. In `asio_open_driver`, `asio_release_driver`, `asio_probe_driver`, `panel_thread_func` verwenden. *Ersetzt Teilumfang von T033 aus 001.*
- [ ] T306 [L-6][F-15] Nach `asio_start_capture`: tatsächliche Rate mit der angefragten vergleichen und an den Hub melden (Warnung + Encoder mit tatsächlicher Rate), wie Ardours `_start`. *Ergänzt T205 aus 002.*
- [ ] T303 [P][L-5][F-16] Probe: Out-Parameter von `getChannels`/`getSampleRate` in einer 4096-Byte-Hilfsstruktur ablegen (PortAudio-Muster gegen schreibende Treiber, z. B. M-Audio); Blacklist-Namen aus `002/T206` übernehmen. *Ergänzt T206 aus 002.*

## Phase 3: Dokumentation
- [ ] T307 [P] `CLAUDE.md`: Abschnitt "Bewusst nicht von PortAudio/Ardour übernommen": Reset-Requests ignorieren (PA #108), kein Overload-Handling, Sample-Typ nur von Kanal 0, alle Kanäle öffnen, Control-Panel ohne COM-Balance. Mit Verweis auf `specs/003-ardour-asio-review/analysis.md`.

## Abhängigkeiten
T301 unabhängig · T304 vor T021 · T305 vor T020 · T302 vor T033/T034 · T306 nach T205 · T303 nach T206.

## Coverage
FR-301…FR-305 sind Berichtsanforderungen und mit `analysis.md` erfüllt; die Tasks decken alle 9 "übernehmen"-Lehren und F-21 ab:
L-1 T304 · L-2 T305 · L-3 T301 · L-4 T208 (002/001) · L-5 T206+T303 · L-6 T205+T306 · L-7 T207 (002) · L-8 T302 · L-9 T201/T202 (002).

## Manuelle Abnahme
1. Zwei ASIO-Geräte gleichzeitig starten: das zweite meldet sofort "belegt".
2. Capture läuft, Geräteliste aktualisieren: Kanalzahlen unverändert bzw. "unbekannt", nie 32.
3. Treiber im Capture beenden (Gerät abziehen): kein Absturz, kein Hänger beim Stop (> 2 s nur bei defektem Treiber).
