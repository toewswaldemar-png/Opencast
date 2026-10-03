# Specification Analysis Report — ASIO-API-Konformität

Prüfgegenstand: `client/internal/audio/asio_host.cpp`, `asio_bridge.go`, `capturer_asio.go`, `client/internal/hub/hub.go`,
`.github/workflows/release.yml`, Repository-Wurzel. Normative Referenz und Belege: [research.md](./research.md).
Findings F-01 … F-13 stehen in [../001-asio-capture-review/analysis.md](../001-asio-capture-review/analysis.md); hier kommen F-14 ff. dazu,
und einige 001-Findings sind durch die Spec präzisiert.

**Konfidenz**: **S** = durch Spec-Wortlaut belegt und im Code gelesen · **V** = nachgerechnet · **P** = plausibel, braucht Windows-Test.
Nicht kompiliert und nicht gegen echte Treiber getestet.

## 1. Konformitätsmatrix (Spec-Stelle → Code)

| Spec-Stelle | Anforderung | Status | Beleg im Code |
|---|---|---|---|
| §II.2 Zustandsautomat | Init → CreateBuffers → Start; Stop → Dispose → Exit | ✔ konform | `asio_open_driver` → `asio_start_capture` → Pump-Cleanup `stop(); disposeBuffers()` → `asio_release_driver` (`Release`) |
| §III.1 ASIOExit / §App. E | Release = Exit, danach keine Callbacks | ✔ | `globalASIOCapturer.Store(nil)` erst nach Pump-Ende |
| §III.2 ASIOStop | Nach Rückkehr keine Callbacks | ✔ | Cleanup vor Freigabe von `g_pcmBuf` |
| §III.3 `getChannels` | `ASE_OK` prüfen, 0 Eingänge behandeln | ✔ | `asio_get_driver_info`, Go prüft `< 1` |
| §III.3 `getBufferSize` | `preferredSize` ist gültig | ✔ | `asio_get_preferred_buffer_size` (Fallback 512 ist nicht spezkonform, siehe F-19) |
| §III.3 `getSampleRate`/`setSampleRate` | Rückgabecodes (`ASE_NoClock`, `ASE_InvalidMode`) auswerten | ✗ | `asio_host.cpp:230-246` ignoriert alle Rückgabewerte → F-15 |
| §III.3 `getChannelInfo` | Typ **je Kanal** | ⚠ | nur Kanal `channels[0]` (`:274-278`); PortAudio hat dieselbe Lücke → F-02 |
| §III.4 `createBuffers` | `ASE_InvalidMode`/`NoMemory` behandeln, Kanäle gültig | ⚠ | Fehler werden gemeldet; Kanalzahl wird still auf 32 gekürzt (`:223`) → F-19 |
| §III.4 `outputReady` | einmal abfragen, nur bei `ASE_OK` aufrufen | ⚠ | `asio_buffer_switch:105` ruft bei jedem Buffer, Rückgabe ignoriert; als ReaRoute-Workaround kommentiert → F-17 |
| §III.5 `controlPanel` | Änderungen kommen als `asioMessage` | ⚠ | Panel-Pfad vorhanden, Folge-Messages werden aber ignoriert → F-03 |
| §III.5 `kAsioCanReportOverload` | Abfrage, `kAsioOverload` auswerten | ✗ | nicht abgefragt, nicht behandelt → F-14 |
| §III.6 `bufferSwitchTimeInfo` | Zeitinfo-Modus per `kAsioSupportsTimeInfo` | ✔ | `asio_message:120`, Callback liefert `params` zurück |
| §III.6 `asioMessage` Reset | Rückgabe `1L`, **Neustart später** | ✗ | Rückgabe korrekt, kein Neustart (`:110-124`) → F-03 |
| §III.6 `sampleRateDidChange` | speichern, ggf. reagieren | ⚠ | leerer Handler (`:110`); Spec lässt Aktion offen, JUCE macht Reset → F-03 |
| §III.6 `kAsioSelectorSupported` | ehrliche Liste | ⚠ | `Resync` und `Overload` fehlen; Reset wird "unterstützt", aber nicht ausgeführt |
| §III.7 Int16/24/32 LSB | korrekt wandeln | ✔ | `asio_sample_to_i16` (Int24 ohne signed-Overflow) |
| §III.7 Int16/32 MSB | byteweise tauschen | ✔ | `:59-71` |
| §III.7 Int24 MSB, Float32/64 MSB | wandeln | ✗ | fallen in `default` (liest Int32 LSB) → F-02 |
| §III.7 Int32LSB/MSB 16/18/20/24 | rechtsbündig, vorzeichenerweitert | ✗ | `default`: `v >> 16` → **−48 dB (24), −73 dB (20), −90 dB (18), Stille (16)** → F-02 |
| §III.7 DSD | wandeln oder ablehnen | ✗ | läuft in `default`, keine Ablehnung → F-02 |
| §App. A Zeitinfo | Modus erkennen | ✔ | wie oben |
| §II.5/6 Start-Callbacks | die ersten Callbacks ignorieren/verträglich | ⚠ | Priming-Stille landet im Stream (≈1–2 Buffer, kosmetisch) |
| §III.3 Latencies "possibly recursively" | Wiedereintritt verkraften | ⚠ | ein gemeinsamer `g_pcmBuf` (`:28, 96-99`) → F-18 |
| §App. D Windows | Host ändert **keine** Treiber-Thread-Prioritäten | ✔ | kein `SetThreadPriority`/MMCSS im Client (grep) |
| §App. G 64-Bit | `HKLM\SOFTWARE\ASIO` | ✔ | `asio_enumerate_drivers:133` |
| COM-Laden (S3) | `CoCreateInstance(clsid, …, CLSCTX_INPROC_SERVER, clsid)`, STA | ✔ | `:185` |
| COM-Balance (S7) | nur bei Erfolg `CoUninitialize` | ✗ in `open`, ✔ in `probe` | → F-07 (aus 001) |
| STA-Pump (S7) | Nachrichten pumpen | ✔ | `asio_run_message_pump` mit `MsgWaitForMultipleObjects` |
| §IV ein aktiver Treiber | Zweitgerät sauber abweisen | ✗ | blockiert in `Start()` → F-05 (aus 001) |
| `init(sysRef)` | Fenster-Handle der Anwendung | ✔ (Praxis) | `GetDesktopWindow()` wie PortAudio |

## 2. Neue und präzisierte Findings

| ID | Kategorie | Severity | Konf. | Fundstelle | Zusammenfassung | Task |
|----|-----------|----------|-------|------------|-----------------|------|
| **F-20** | Constitution IX / FR-112 | **HIGH** (nicht-technisch) | S | Repo-Wurzel (kein `LICENSE`), `.github/workflows/release.yml:53-100` | Das SDK ist seit Oktober 2025 dual lizenziert (Steinberg ASIO License **oder** GPLv3). Opencast hat keine Lizenzdatei und keine Markenhinweise, baut aber `opencast-client-asio.exe` mit dem SDK (Secret `ASIO_SDK_ZIP_B64`) und hängt es an GitHub-Releases. Welche Variante gilt, ist ungeklärt. GPLv3-Weg: Gesamtwerk unter GPLv3 mit Quelltext. Proprietärer Weg: Vereinbarung mit Steinberg und Beachtung der Usage Guidelines. Positiv: SDK ist per `.gitignore` ausgeschlossen. *Keine Rechtsberatung.* | T210 |
| **F-02** (präzisiert) | Constitution IV / FR-103 | CRITICAL | S+V | `asio_host.cpp:72-75, 274-278` | Die Spec definiert die `Int32LSB16/18/20/24` als **rechtsbündig**. Der `default`-Zweig liest sie als linksbündig: Vollausschlag wird zu 127 (24 Bit, −48 dB), 7 (20 Bit, −73 dB), 1 (18 Bit, −90 dB), 0 (16 Bit). **Das ist fast Stille, nicht Rauschen** (Korrektur zu 001). `Int24MSB`, `Float32MSB`, `Float64MSB` und DSD laufen ebenfalls in `default` und liefern Müll. Praxisrelevant bei Interfaces mit 24-in-32-Treibern. PortAudio unterstützt alle diese Typen. | T201, T202 |
| **F-03** (präzisiert) | Constitution VI / FR-102 | HIGH | S | `asio_host.cpp:110-124`, `capturer_asio.go:203-215` | Die Spec verlangt: Antwort `1L`, dann Neustart zu einem "safe time" **außerhalb** des Callbacks. Opencast antwortet korrekt, startet aber nie neu. JUCE entprellt mit 500 ms und behandelt auch `BufferSizeChange`, `Resync` und `sampleRateDidChange` so; nicht während das Control-Panel offen ist. Zusätzlich liefert `bufferSwitchTimeInfo` im `ASIOTime.timeInfo.flags` ein `kSampleRateChanged`-Flag, das zur Erkennung genutzt werden kann. | T203 |
| **F-14** | FR-105 | MEDIUM | S | `asio_host.cpp` (kein `future()`-Aufruf) | `ASIOFuture(kAsioCanReportOverload)` wird nie abgefragt, `kAsioOverload` nie behandelt. Drop-outs im Treiber bleiben unsichtbar; für einen Streaming-Client ist das die wichtigste Diagnose. JUCE zählt sie als xruns. | T204 |
| **F-15** | FR-104 | MEDIUM | S | `asio_host.cpp:230-246`, `capturer_asio.go:189` | `getSampleRate` ist mit `48000.0` vorbelegt und die Rückgabewerte von `canSampleRate`/`setSampleRate`/`getSampleRate` werden ignoriert. Bei externer Clock ohne Signal liefert der Treiber `ASE_NoClock` + 0; `setSampleRate(≠0)` ergibt `ASE_InvalidMode`. Dann wird `actualSampleRate = 0` und `ActualConfig()` fällt auf die **angefragte** Rate zurück: Der Encoder bekommt eine geratene Rate, Tonhöhe/Dauer falsch. | T205 |
| **F-16** | FR-107 | MEDIUM | L | `asio_bridge.go:111-139, 186-200` | `asioEnumerateDrivers` probt **alle** registrierten Treiber im Prozess, sequenziell, ohne Zeitlimit und ohne Blacklist. `asioProbeDriverSTA` wartet unbegrenzt auf `<-res`. Ein hängender oder abstürzender Treiber (Dialog, Kopierschutz, Wrapper-Treiber wie "ASIO DirectX Full Duplex") blockiert die Geräteliste oder reißt den Client mit; währenddessen hält der Probe `asioGlobalMu`. PortAudio führt dafür eine Blacklist; JUCE kapselt Aufrufe in Exception-Handler. | T206 |
| **F-17** | FR-106 | LOW | S | `asio_host.cpp:103-105` | Alle drei Referenz-Hosts fragen `outputReady()` **einmal** ab und rufen nur bei `ASE_OK` weiter auf; die Spec sagt, `ASE_NotPresent` solle weitere Aufrufe verhindern. Opencast ruft jedes Mal und ignoriert die Rückgabe (Workaround für ReaRoute laut Kommentar). Möglich: Die einmalige **Abfrage** (`ASIOOutputReady()` beim Setup) ist es, die ReaRoute freischaltet. Test auf Hardware. | T207 |
| **F-18** | FR-108 | LOW | P | `asio_host.cpp:28, 96-99` | Ein prozessweites `g_pcmBuf`, nicht wiedereintrittsfest. Die Spec nennt "possibly recursively" für den Fall, dass der Host einen Block zu spät bearbeitet; PortAudio führt `reenterCount`. Greift ein Treiber aus zwei Threads/Kontexten zu, entstehen verfälschte Puffer. | T208 |
| **F-19** | FR-113 | LOW | L | `asio_host.cpp:223, 212-217`, `hub.go:331` | `numChannels` wird auf 32 gekürzt, der Hub nimmt aber `nativeCh = len(chs)`; Zuordnung bricht ab Kanal 33. `getBufferSize`-Fehlschlag liefert 512, was die Spec nicht garantiert (→ `ASE_InvalidMode` bei `createBuffers`; die Fehlermeldung ist dann irreführend). | T209 |
| **F-04** (Hinweis) | FR-003 | CRITICAL | L | s. 001 | Unverändert. Die Spec liefert `ASE_InvalidMode` für ungültige Kanäle in `createBuffers`; richtig ist, das nicht durch Clamping vorwegzunehmen. | T012 |
| F-01, F-05…F-13 | — | wie in 001 | — | — | Unverändert. F-07 (COM-Balance) wird durch cwASIO-Issue #9 und PortAudio als bekanntes Muster gestützt. | — |

## 3. Gegenprobe: Was ich geprüft habe und **kein** Befund ist
- `GetDesktopWindow()` als `sysRef` und Typ-Bestimmung nur über Kanal 0: Spec nennt "application main window handle", Praxis (PortAudio) identisch → nur LOW, im Plan nicht eingeplant.
- `directProcess` wird ignoriert: Spec §II.5 sagt, unter Windows könne der Callback immer verarbeiten.
- `kAsioSupportsTimeInfo = 1`: spezkonform und laut Appendix A empfohlen (JUCE antwortet 0, Opencast braucht 1 laut `CLAUDE.md`).
- Reihenfolge Stop → Dispose → Release: entspricht Spec und Referenz-Host.
- Keine Thread-Prioritätsänderungen am Treiber-Thread: entspricht Appendix D.

## 4. Metriken
- Matrix: 30 Prüfpunkte — ✔ 14 · ⚠ 8 · ✗ 7 · gemischt 1 (COM-Balance: ✗ in `open`, ✔ in `probe`).
- Neue Findings: 7 (F-14 … F-20), präzisiert: F-02, F-03. Severity in 002: CRITICAL 1 (F-02), HIGH 2 (F-03, F-20), MEDIUM 3, LOW 3 (ohne F-04-Hinweis).
- Requirements 13, Tasks 11 (T201 … T211), Coverage 100 % (siehe tasks.md; FR-101/109/110 sind bereits konform).

## 5. Next Actions
1. **F-20 zuerst entscheiden** (Lizenz): Das ist keine Code-Frage und blockiert jede weitere Veröffentlichung des ASIO-Clients.
2. **F-02** (T201/T202): kleine, lokale Änderung mit klarem Referenzwert; zusammen mit T013/T014 aus 001.
3. **F-03** (T203): größerer Eingriff; Muster wie JUCE (Flag im Callback, Neustart per Timer außerhalb), Hardware-Test nötig.
4. **F-15, F-14, F-16**: danach, jeweils mit eigenem Test.

Soll ich T201/T202 (Konvertierungstabelle mit Tests) umsetzen? Das ist ohne Windows prüfbar, wenn die Funktion als reine Go-Referenz neben der C++-Version liegt.
