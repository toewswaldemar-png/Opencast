# Specification Analysis Report — ASIO-Capture

Prüfung von `client/internal/audio/{asio_bridge.go,capturer_asio.go,asio_host.cpp,asio_host.h,types.go,level.go}`,
`client/internal/hub/hub.go`, `client/main_windows.go` gegen `spec.md` und die Constitution.
Methode: Spec-Kit-Ablauf (Constitution → Spec → Plan → Tasks → Analyse), Code vollständig gelesen.

## Was geprüft und was nicht geprüft wurde
- **Verifiziert**: `GOOS=windows go vet ./...` (ohne ASIO-Tag) ist sauber. F-01 wurde als Rechnung nachgestellt (siehe dort).
- **Nur aus dem Code gelesen**: alle übrigen Findings. Kein Windows, kein MinGW, kein ASIO SDK in dieser Sitzung →
  `-tags asio` ließ sich **nicht kompilieren**, `hub_test.go` ist unter Linux nicht lauffähig (Build-Tag `windows`),
  kein Treiber-/Hardwaretest.
- Konfidenz je Finding steht in der Tabelle: **V** = nachgestellt, **L** = aus Code gelesen, **P** = plausibel, braucht Windows-Test.

## Findings

| ID | Kategorie | Severity | Konf. | Fundstelle | Zusammenfassung | Empfehlung |
|----|-----------|----------|-------|------------|-----------------|------------|
| F-01 | Constitution III / FR-004 | CRITICAL | V | `asio_bridge.go:63-79`, `hub.go:331,550`, `level.go:32` | Bei **einem** geöffneten Kanal (L==R) expandiert die Bridge Mono zu Stereo (`frames*4` Bytes), der Hub setzt aber `nativeCh = len(chs) = 1` und ruft `ExtractStereoBytes(buf, 1, 0, 0)`. Der Puffer wird als Mono gelesen → **doppelt so viele Frames** (nachgestellt: 512 → 1024). Folge: Mono-Stream läuft mit halber Geschwindigkeit/eine Oktave tiefer. Der Monitor-Pfad ist nicht betroffen. `hub_test.go` testet das nicht, weil der Mock die Bridge umgeht. | T010, T011 |
| F-02 | Constitution IV / FR-006 | CRITICAL | L | `asio_host.cpp:72-75, 276-278` | Unbehandelte Typen (Int32LSB16/18/20/24, Int24MSB, Float32MSB, Float64MSB, DSD) laufen in den `default`-Zweig und werden als Int32LSB gelesen statt Fehler. **Präzisiert in 002 mit der offiziellen Spec:** die `Int32LSB16..24` sind rechtsbündig, Vollausschlag ergibt dadurch nur 127 / 7 / 1 / 0 (−48 / −73 / −90 dB / Stille), also fast Stille und nicht Rauschen; `Int24MSB`/`Float*MSB`/DSD liefern Müll. Der Typ wird nur von Kanal 0 bestimmt (PortAudio hat dieselbe Lücke). | T013, T014 |
| F-04 | Constitution III / FR-003 | CRITICAL | L | `capturer_asio.go:143-147, 163-168`, `asio_bridge.go:148-159, 170` | Kanäle ≥ `numInputCh` werden still auf den letzten Kanal gezogen (kann Duplikate erzeugen, `openChs` weicht von den geöffneten Kanälen ab). Verschärft durch Probe-Fallback "32 Kanäle", der der UI Kanäle anbietet, die es nicht gibt. | T012, T020 |
| F-12 | Constitution VII / FR-011 | HIGH | L | `.github/workflows/release.yml` (nur Build), kein `*_test.go` in `internal/audio` | Bridge, Konvertierung, Mapping ungetestet; CI vettet/testet den Client nicht. F-01 wäre damit aufgefallen. | T001-T003, T014 |
| F-03 | Constitution VI / FR-008 | HIGH | L | `asio_host.cpp:110-124`, `capturer_asio.go:203-215` | `asio_message` antwortet auf `kAsioResetRequest` mit 1 ("behandelt"), tut aber nichts; `sampleRateDidChange` wird ignoriert. `callbackFired` wird nie zurückgesetzt, der Watchdog prüft nur die ersten 5 s → späterer Stillstand (Gerät weg, Reset) bleibt unerkannt. | T030, T031 |
| F-05 | Constitution II / FR-001, FR-002 | MEDIUM | L | `asio_bridge.go:152-160`, `capturer_asio.go:100` | `asioGlobalMu` ist global über alle Treiber. Läuft ein Capture, schlägt der Probe **jedes anderen** Geräts fehl → Cache oder erfundene 32 Kanäle. Ein zweiter Hub für ein anderes ASIO-Gerät blockiert in `Start()` unbegrenzt auf dem Mutex, während er `Hub.startMu` hält (in `registry.go` habe ich keine Absicherung gefunden). | T020, T021 |
| F-06 | Constitution II / FR-007 | MEDIUM | P | `asio_host.cpp:334-336, 356`, `capturer_asio.go:195-201` | `g_stopEvent` ist ein nicht-atomares Prozess-Global und nicht an den Capturer gebunden. Eine verspätete `asio_stop()`-Goroutine eines alten Capturers kann (a) ein geschlossenes Handle verwenden (TOCTOU) oder (b) den nächsten Capturer stoppen. Heute durch Timing meist entschärft. | T032 |
| F-07 | Constitution II / FR-007 | MEDIUM | L | `asio_host.cpp:180-183, 189, 196, 432` | `asio_open_driver` akzeptiert `RPC_E_CHANGED_MODE`, ruft aber später unbedingt `CoUninitialize()` (Fehlerpfade und `asio_release_driver`) → unbalancierter Uninit. `asio_probe_driver` macht es mit `didCoInit` richtig. | T033 |
| F-08 | FR-009 | MEDIUM | P | `asio_host.cpp:547-554, 575` | Panel-Thread ohne laufenden Capturer: `GetMessage`-Schleife hat keine Abbruchbedingung (`PostQuitMessage` im Event-Hook trifft nur den Monitor-Thread). `asio->Release()` ist unerreichbar; `OpenASIOControlPanelSync` kehrt erst nach 120 s Timeout zurück, `activePanelClsid` bleibt so lange gesetzt. **Braucht Windows-Test**, da viele Treiber `controlPanel()` modal ausführen. | T034 |
| F-09 | Constitution I, V / FR-005, FR-012 | MEDIUM | L | `hub.go:520-550, 567-588`, `CLAUDE.md` | CLAUDE.md verspricht "kein Mutex im Callback-Hotpath" und "Monitor ohne Allokation". Der Hub nimmt in **beiden** Callbacks `h.mu` und allokiert (`entries`, `ExtractStereoBytes` je Subscriber/Buffer) auf dem Treiberthread. `computeLevelFromC` (der dokumentierte Zero-Alloc-Pfad) wird im Hub-Betrieb nie erreicht, weil dort immer ein `multiLevelCb` installiert ist. CLAUDE.md nennt `monitor.go Start()` für den Deadlock-Fix; im Client existiert nur `hub.go` (`monitor.go` liegt in `backend/internal/stream/`). | T040, T041, T051 |
| F-10 | FR-005 | LOW | L | `capturer_asio.go:61, 233-246`, `asio_bridge.go:58-79` | Nach jedem Start hat `pcmOut` 32 freie Slots, die für ASIO niemand leert. Die ersten 32 Callbacks nehmen den Allokationspfad, Pegel gehen an `c.levels` (ungelesen), `multiLevelCb` wird nicht gerufen → ca. 0,3 s ohne VU nach Start (512 Frames @ 48 kHz). Danach werden Pegel doppelt berechnet (`sendLevels` und Hub). | T042 |
| F-11 | Constitution VI / FR-010 | LOW | L | `capturer_asio.go:203-215`, `hub.go:396-399` | ReaRoute ohne REAPER: Watchdog stoppt nach 5 s, Hub startet nach 3 s neu — endlos, mit je einem COM-/Treiber-Open und einem weiteren geleakten WSAStartup-Refcount. Der Leak selbst ist dokumentiert und gewollt. | T035 |
| F-13 | Constitution Randbedingung / FR-012 | LOW | L | `backend/internal/audio/asio_host.cpp`, `Makefile:19-24` | Zweite, ältere ASIO-Implementierung in `backend/` (Makefile baut sie), ohne den WSAStartup-Fix (kein `WSAStartup` außerhalb `client/`). CLAUDE.md beschreibt `server/`+`client/`, nicht `backend/`. | T050, T051 |

## Coverage Summary

| Requirement | Task(s) | Abgedeckt |
|---|---|---|
| FR-001 Discovery | T020 | ✔ |
| FR-002 Ein Treiber | T021 | ✔ |
| FR-003 Kanalvalidierung | T012 | ✔ |
| FR-004 Frame-Vertrag | T010, T011 | ✔ |
| FR-005 Callback-RT | T040, T041, T042 | ✔ |
| FR-006 Sample-Typen | T013, T014 | ✔ |
| FR-007 Lebenszyklus | T032, T033 | ✔ |
| FR-008 Treibernachrichten/Stall | T030, T031 | ✔ |
| FR-009 Panel | T034 | ✔ |
| FR-010 Backoff | T035 | ✔ |
| FR-011 Tests/CI | T001-T003, T014 | ✔ |
| FR-012 Doku | T051 | ✔ |

**Metriken**: 12 Requirements · 21 Tasks · Coverage 100 % · 13 Findings
(CRITICAL 3, HIGH 2, MEDIUM 5, LOW 3) · Ambiguitäten 0 · Duplikate 0.
Die Severity folgt der Spec-Kit-Regel "Constitution-Verstoß = CRITICAL"; **echte Nutzerwirkung** hat nach meiner Einschätzung
zuerst F-01 (nur verifiziert als Rechnung, nicht auf Hardware) und F-02 (nur bei betroffenen Interfaces).

## Was gut gelöst ist
- Winsock-Refcount-Fix und Include-Reihenfolge sind umgesetzt und kommentiert.
- `globalASIOCapturer` als `atomic.Pointer`, Fast-Path-Return im Callback, Probe mit `TryLock` und Cache.
- Hub: Phasen-Locking in `addSub`, Re-Check nach `startMu`, Watcher mit Unterscheidung beabsichtigt/unerwartet.
- Int24-Konvertierung ohne signed-overflow-UB; Zero-Init der Doppelpuffer gegen ReaRoute-Altdaten.
- `setSampleRate` nur bei Bedarf (vermeidet 10-20 s USB-Resync).

## Next Actions
1. **Vor weiterer Arbeit** F-01 auf Windows mit ASIO-Build gegenprüfen (Mono-Stream, Dauer messen). Danach T001 → T010 → T011.
2. T003 (CI mit `go vet`/`go test`) zuerst, damit alles Weitere abgesichert ist.
3. F-02 (T013) und F-04 (T012) direkt danach; sie sind klein und lokal.
4. Alles unter Phase 4 braucht einen manuellen Hardware-Lauf (ReaRoute, UR22mkII).

Soll ich mit T001-T003 und dem Test für F-01 (rot) beginnen?
