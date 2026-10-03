# Specification Analysis Report — Ardours ASIO-Umsetzung

Geprüft: Ardour `f39f9d8` (`libs/backends/portaudio/*`, `gtk2_ardour/engine_dialog.cc`, `tools/x-win/*`) und
PortAudio `873e3c8` (`src/hostapi/asio/pa_asio.cpp`, `src/os/win/pa_win_coinitialize.c`) gegen die ASIO-2.3-Spezifikation
(Normbasis wie `002`). Details und Zeilen: [research.md](./research.md).
**Konfidenz**: **S** = Spec-Wortlaut + Code gelesen · **L** = nur Code gelesen · **P** = plausibel, braucht Windows/Hardware.
Nicht kompiliert, nicht gegen Treiber gelaufen.

**Kernaussage**: Ardours ASIO-Unterstützung ist PortAudios ASIO-Host mit einem dünnen Adapter. Der Host ist robust gegen
Treiber-Eigenheiten (Blacklist, Wiedereintritt, nachlaufende Callbacks, Retry mit `preferredSize`), aber **nicht spec-vollständig**:
Reset-Requests und Overloads werden ignoriert. Er ist ein gutes Vorbild für Robustheit, kein Vorbild für Spec-Vollständigkeit.

## 1. Konformitätsmatrix (PortAudio-ASIO-Host, wie in Ardour genutzt)

| # | Spec-Stelle | Anforderung | Urteil | Beleg | Schicht |
|---|---|---|---|---|---|
| 1 | §II.2 Zustandsautomat | Init → CreateBuffers → Start; Stop → Dispose → Exit | ✔ | `LoadAsioDriver`, `OpenStream`, `StartStream`, `StopStream` | PA |
| 2 | §III.2 `ASIOStop` | Nach Stop keine Callbacks | ✔ **über Spec hinaus** | `EnsureCallbackHasCompleted` wartet ≤ 2 s (3378-3388) | PA |
| 3 | §III.1 Exit | Dispose vor Exit | ✔ | `ASIODisposeBuffers` (2793, 2848), `UnloadAsioDriver` | PA |
| 4 | §III.6 `kAsioResetRequest` | `1L`, Neustart zu sicherer Zeit | ✗ | nur `ret = 1L` (3216-3229), Ticket #108 | PA |
| 5 | §III.6 `kAsioBufferSizeChange` | Host darf ablehnen (0) | ✔ | Default `0` | PA |
| 6 | §III.6 `kAsioSelectorSupported` | ehrliche Liste | ✔ | Liste wie im SDK-Beispiel (3200-3209); "unterstützt" Reset, ohne zu handeln (→ #4) | PA |
| 7 | §III.6 `sampleRateDidChange` | speichern, Aktion offen | ⚠ | nur Log (3173-3185); Spec erlaubt das | PA |
| 8 | §III.5 Overload | `kAsioCanReportOverload` abfragen, `kAsioOverload` auswerten | ✗ | kein `ASIOFuture`, keine Selektorbehandlung; nur Reentry-Heuristik | PA |
| 9 | §III.7 PCM/Float LSB+MSB | wandeln | ✔ | 336-425, 649-870 | PA |
| 10 | §III.7 `Int32*16/18/20/24` | rechtsbündig, vorzeichenerweitert | ✔ | `ASIOSTInt32LSB24` → Linksschub 8 (718/864) | PA |
| 11 | §III.7 DSD | wandeln oder ablehnen | ⚠ | `default → paCustomFormat` (generische Ablehnung, keine Typangabe) | PA |
| 12 | §III.3 Typ je Kanal | je Kanal | ⚠ | `FIXME: assume all channels use the same type` (2394, 2415) | PA |
| 13 | §III.4 `ASIOOutputReady` | einmal abfragen, nur bei `ASE_OK` aufrufen | ✔ | `postOutput` (988-991, 2984, 3135) | PA |
| 14 | §III.3 Latencies "possibly recursively" | Wiedereintritt verkraften | ✔ | `reenterCount` + Schleife (2954-2960, 3167) | PA |
| 15 | §III.3 Samplerate | Rückgabecodes auswerten | ✔ (⚠ Ext.-Clock deaktiviert) | `ValidateAndSetSampleRate` (1923-1980), `if( false )` für `SetSampleRate(0)` | PA |
| 16 | §III.3 `getBufferSize` | min/max/preferred/Granularität | ✔ | `SelectHostBufferSize`; Ardour-Liste `portaudio_io.cc:214-289` | PA+Ardour |
| 17 | §III.4 `createBuffers` | `ASE_InvalidMode` bei ungültiger Größe | ✔ **über Spec hinaus** | Retry mit `preferredSize` (2290-2314, Hoontech DSP24) | PA |
| 18 | §IV "one active driver" | Zweitgerät sauber abweisen | ✔ | `paDeviceUnavailable` (2032-2036) | PA |
| 19 | §IV/Praxis Probe | Treiber nicht gefährden | ⚠ | Blacklist + Debugger-Check + 4096-Byte-Padding (1019-1022, 1285-1300); **kein Timeout** | PA |
| 20 | COM-Balance | nur bei Erfolg `CoUninitialize`, gleiche Thread | ⚠ | `PaWinUtil_CoInitialize` tolerant, thread-gebunden ✔; **Control-Panel-Erfolgspfad ohne `CoUninitialize`** (~4104-4107) | PA |
| 21 | `init(sysRef)` | Fenster-Handle | ✔ (⚠ Ardour: NULL) | `GetDesktopWindow()` (1232); `portaudio_io.cc:85` übergibt `NULL` | PA / Ardour |
| 22 | §App. D | Host ändert keine Treiber-Thread-Prioritäten | ✔ | MMCSS nur auf Ardours eigenen Threads (`portaudio_backend.cc:1049-1105`) | Ardour |
| 23 | §App. A | `kAsioSupportsTimeInfo` | ✔ | `ret = 1` | PA |

**Summe**: 23 Punkte — ✔ 15 · ⚠ 6 · ✗ 2.

## 2. Findings zu Ardour/PortAudio

| ID | Schicht | Severity | Konf. | Fundstelle | Zusammenfassung |
|----|---------|----------|-------|------------|-----------------|
| **A-01** | PortAudio | HIGH (Spec) | S | `pa_asio.cpp:3216-3229` | `kAsioResetRequest` wird mit `1L` bestätigt, aber **nie ausgeführt** (Ticket #108). Der Treiber nimmt an, der Host starte neu. Ardour fängt das nur indirekt auf: Änderungen an Rate/Puffer sind im Lauf gesperrt (`portaudio_backend.cc:256-266`), Panel nur bei gestoppter Engine (`pa_asio.cpp:4040-4048`). Ändert der Treiber von sich aus die Konfiguration, bleibt die Engine stehen oder läuft falsch weiter, bis der Nutzer neu startet. |
| **A-02** | PortAudio | MEDIUM | S | (Fehlstelle) | Kein `kAsioCanReportOverload`/`kAsioOverload`. Ardours Xruns kommen nur aus der Reentry-Heuristik (`portaudio_backend.cc:757-765`) und erfassen treiberseitig erkannte Aussetzer nicht. |
| **A-03** | PortAudio | MEDIUM | S | `pa_asio.cpp:2394, 2415` | Sample-Typ nur von Kanal 0 (Ticket #106); DSD generisch abgelehnt. Gleiche Lücke wie F-02 (Opencast). |
| **A-04** | PortAudio | LOW | L | `pa_asio.cpp:~4104-4112` | `PaAsio_ShowControlPanel`: im Erfolgspfad fehlt `PaWinUtil_CoUninitialize` (nur im Fehlerpfad). Pro Panel-Aufruf bleibt ein `CoInitialize` offen (nur wenn die Funktion die Initialisierung selbst vorgenommen hat). |
| **A-05** | PortAudio+Ardour | MEDIUM | L | `pa_asio.cpp:1262-1330`, `portaudio_io.cc:564-581` | Alle Treiber werden im UI-/Init-Pfad sequenziell geprobt, jedes Gerät-Refresh (`pa_deinitialize` + `pa_initialize`) macht das erneut; **kein Timeout** → ein hängender Treiber blockiert Ardours Geräteliste. Gemildert durch Blacklist und Debugger-Check. Gleiche Schwäche wie F-16. |
| **A-06** | Ardour | LOW | L | `portaudio_io.cc:114-119` | Samplerates für ASIO sind eine feste Liste ohne Treiberabfrage; nicht unterstützte Raten fallen erst beim Öffnen auf (`SampleRateNotSupportedError`). Bewusster Kompromiss gegen Treiber-Probes. |
| **A-07** | Ardour | LOW | L | `portaudio_io.cc:85` | Control-Panel mit `NULL`-Handle: Treiber, die ein echtes `HWND` brauchen (z. B. einige Yamaha), können scheitern; Fehler nur als Debug-Log (88-91). Opencast probt zuerst `NULL`, dann mit Fenster — toleranter. |
| **A-08** | Ardour | INFO | L | `portaudio_io.cc:694-706` | Ardour öffnet **alle** Kanäle des Geräts. Das vermeidet Neustarts bei Kanalwechsel, kostet aber CPU/Speicher. Für Opencast (Kanalauswahl, Capture only) nicht übernehmen. |

## 3. Lehren für Opencast

| Lehre | Muster in PortAudio/Ardour | Bezug | Empfehlung | Task |
|---|---|---|---|---|
| L-1 | Zweiter `OpenStream` → sofort `paDeviceUnavailable` (`pa_asio.cpp:2032-2036`) | F-05 | **Übernehmen**: sofortiger Fehler statt Blockieren auf `asioGlobalMu` | T304 (→T021) |
| L-2 | Kein Re-Probe bei offenem Stream (`portaudio_io.cc:568`), feste Raten-Liste | F-04, F-05 | **Übernehmen**: im Capture-Betrieb nur Cache anzeigen, **nie** 32 Kanäle erfinden | T305 (→T020) |
| L-3 | `EnsureCallbackHasCompleted` (3378-3388) | **neu F-21** | **Übernehmen** | T301 |
| L-4 | `reenterCount` | F-18 | **Übernehmen** | T208 |
| L-5 | Blacklist + 4096-Byte-Padding für Out-Parameter | F-16 | **Übernehmen** (zusätzlich Timeout, den PA nicht hat) | T206, T303 |
| L-6 | `ValidateAndSetSampleRate`: Fehlercodes prüfen, nur bei Abweichung setzen; Ardour gleicht Rate nach dem Öffnen ab | F-15 | **Übernehmen** | T205, T306 |
| L-7 | `postOutput`-Probe (988-991) | F-17 | **Erst messen** (ReaRoute), dann angleichen | T207 |
| L-8 | `PaWinUtil_CoInitialize`: `RPC_E_CHANGED_MODE` tolerieren, Thread-ID merken, nur bei Init-Erfolg auf demselben Thread `CoUninitialize` | F-07 | **Übernehmen** als Vorlage | T302 (→T033) |
| L-9 | Konverter-Tabelle `Int32LSB16/18/20/24` → Shift 16/14/12/8 | F-02 | **Übernehmen** als Referenz für Testvektoren | T201, T202 |
| L-10 | Retry von `createBuffers` mit `preferredSize` | — | Nicht nötig: Opencast nutzt bereits `preferredSize` | — |
| **N-1** | `kAsioResetRequest` ignorieren (A-01) | F-03 | **Nicht übernehmen**; JUCE-Muster (deferred Reset) verwenden | T203 |
| **N-2** | Kein Overload-Handling (A-02) | F-14 | **Nicht übernehmen** | T204 |
| **N-3** | Typ nur von Kanal 0 (A-03) | F-02 | **Nicht übernehmen** | T211 |
| **N-4** | Alle Kanäle öffnen (A-08) | — | **Nicht übernehmen** (Capture-only) | — |
| **N-5** | Control-Panel ohne `CoUninitialize` im Erfolgspfad (A-04) | F-07/F-08 | **Nicht übernehmen**; Panel-Thread muss alle Pfade balancieren | T034 |

## 4. Neuer Befund in Opencast, aus dem Vergleich abgeleitet

| ID | Kategorie | Severity | Konf. | Fundstelle | Zusammenfassung | Task |
|----|-----------|----------|-------|------------|-----------------|------|
| **F-21** | Constitution II / VI | MEDIUM | P | `asio_host.cpp:353-356` | Nach `g_asio->stop()` und `disposeBuffers()` gibt `asio_run_message_pump` sofort `g_pcmBuf` frei und setzt `g_numChannels/g_bufferSize` ohne Synchronisation. PortAudio dokumentiert (`EnsureCallbackHasCompleted`), dass ein Callback **nach** `ASIOStop` noch laufen kann ("observed to happen on the Hoontech DSP24"), obwohl die Spec das verbietet (§III.2). Ein verspäteter Callback läse dann `g_pcmBuf` nach `free` (Use-after-free) oder einen halben Zustand. Abhängig von Treiberfehlern, daher P. | T301 |

## 5. Unterschiede im Einsatzzweck (FR-304)
| | Ardour/PortAudio | Opencast |
|---|---|---|
| Richtung | Vollduplex (Input + Output) | nur Input |
| Kanäle | alle | Auswahl (L/R, Union über Subscriber) |
| Modus | Callback (Standard) oder Blocking-Ringpuffer | Callback → Go |
| Konfig-Änderung | nur bei gestoppter Engine | Hub startet automatisch neu |
| Treiber pro Prozess | einer (`openAsioDeviceIndex`) | faktisch einer (`asioGlobalMu`), aber ohne Fehlermeldung |
| Probe | alle Treiber, beim Init/Refresh | alle Treiber, bei jeder Geräteliste, auch im Capture |

## 6. Metriken
Matrix 23 Punkte — ✔ 15 · ⚠ 6 · ✗ 2. Findings Ardour/PortAudio: 8 (HIGH 1, MEDIUM 3, LOW 3, INFO 1). Lehren: 9 übernehmen, 5 nicht übernehmen.
Neuer Opencast-Befund: 1 (F-21). Requirements 5, Coverage 100 % (siehe `tasks.md`).

## 7. Grenzen
- Nicht kompiliert, nicht ausgeführt, keine Hardware.
- PortAudio `master` statt der in Ardours Release-Builds verwendeten Version (extern, nicht ableitbar).
- Ob und wie Ardours offizielle Binaries das ASIO SDK lizenzieren (GPLv3 oder Steinberg-Lizenz), ist aus dem Repo nicht erkennbar.

## 8. Next Actions
1. **T301 (F-21)** und **T304 (L-1)**: klein, robust, hohen Nutzen; beide ohne Treiber-Spezialwissen.
2. **T302** (COM-Muster aus `PaWinUtil_CoInitialize`) zusammen mit T033.
3. Vor T207 `outputReady`-Verhalten von ReaRoute messen.
4. Reset (T203) und Overload (T204) bewusst **über** das PortAudio/Ardour-Niveau hinaus umsetzen.

Soll ich T301/T302/T304 als Code-Änderung vorbereiten (Go-Anteile testbar, C++-Anteile nur im Windows-CI baubar)?
