# Specification Analysis Report — Opencast ASIO, Tiefenprüfung

Grundlage: ausgeführte Tests und Simulation ([research.md](./research.md)) plus Lesen der bisher nicht geprüften Teile.
**Konfidenz**: **V** = durch Ausführung nachgewiesen (echter Hub-Code, Bridge als Nachbau) · **S** = Simulation/Rechnung · **L** = aus Code gelesen · **P** = plausibel, braucht Windows/Hardware.
Der cgo-/C++-Teil wurde nicht kompiliert oder ausgeführt.

## 1. Ergebnis in einem Satz
Der Hub ist unter der Spec-Zusage "nach `ASIOStop` kein Callback mehr" **race-frei** (5/5 Läufe mit `-race`), hat aber zwei durch Ausführung
**nachgewiesene Logikfehler** (Mono-Stream doppelt lang, falsche Kanäle nach Unsubscribe), kein Takt-Management (periodische Glitches)
und einen unabgesicherten Befehlspfad (jede `deviceId` führt zu `CoCreateInstance`).

## 2. Neue Findings (ab F-22)

| ID | Kategorie | Severity | Konf. | Fundstelle | Zusammenfassung | Task |
|----|-----------|----------|-------|------------|-----------------|------|
| **F-23** | Constitution III / FR-401 | **HIGH** | **V** | `hub.go:114-118, 159-162` (`recomputePositions(h.openChs)`), `hub.go:520-550, 567-588` (Nutzung mit `h.nativeCh`) | Beim `Unsubscribe`/`StopMonitors` wird die Union neu berechnet und die Positionen der **übrigen** Subscriber werden gegen die **neue, kleinere** Union gesetzt. Der Capturer läuft aber weiter mit der **alten** Kanalfolge (`capChs`, `nativeCh` unverändert). Test: Monitor A (Kanal 1/2) + Stream B (Kanal 3/4), A beendet → B-Positionen (0,1) statt (2,3), gemessener Pegel −30,3 dBFS (Kanal 1) statt −20,8 dBFS (Kanal 3). **B sendet/zeigt dann ein anderes Kanalpaar.** Tritt auf, sobald ein entfernter Subscriber niedrigere Kanäle hatte als ein verbleibender — Standardfall bei mehreren ReaRoute-Paaren. Auch `addSub` Phase 1 setzt Positionen vor dem Neustart auf die neue Union (kurzes Zeitfenster). | T401 |
| **F-01** (bestätigt) | Constitution III / FR-004 | CRITICAL | **V** | `asio_bridge.go:63-79`, `hub.go:331, 550` | Durch den echten Hub bestätigt: 12 Callbacks à 256 Frames ergeben **24** statt 12 Hub-Frames (Faktor 2,0). Bridge-Seite ist ein Nachbau der Logik. | T011/T402 |
| **F-22** | Constitution VI / FR-403 | MEDIUM–HIGH | **S** | `streamsession/session.go:131-148`, `hub.go:20-25` | Producer (ASIO-Takt) und Consumer (Wanduhr-Ticker) laufen ohne Pufferstandsregelung. Simulation mit echtem `PCMBuffer`: bei 50 ppm Drift (Interface langsamer) **alle ≈ 106 s ein Underrun** (34/h), bei 100 ppm 68/h; bei Drift in die andere Richtung wächst die Latenz bis ≈ 267 ms, dann werden Frames verworfen (20–26/h bei −100 ppm). Vorfüllung ändert daran nichts. Jeder Underrun ist eine eingefügte Stille von 5,3 ms (hörbares Knacken). Reale Taktabweichungen von USB-Interfaces gegen die PC-Uhr liegen typischerweise im Bereich zig ppm; Messwerte für Opencast fehlen. Betrifft auch WASAPI. | T403 |
| **F-24** | FR-402 | MEDIUM | **V** (Verhalten) / P (Dauer) | `hub.go:283-290` | Startet ein Monitor mit Kanälen außerhalb von `capChs`, während ein Stream läuft, wird der Capturer neu gestartet (Test: 2 Starts, alter gestoppt, Session bleibt und sendet **Stille**). Dauer des Neustarts ist treiberabhängig (`open_driver`, `createBuffers`, `start`); Hardware-Messwerte liegen nicht vor. Wer während des Streams die VU-Anzeige eines anderen Paares öffnet, erzeugt eine hörbare Lücke. Ardour öffnet deshalb alle Kanäle (siehe 003 A-08). | T404 |
| **F-28** | Sicherheit / FR-407, FR-408 | **HIGH** | L | `server/main.go:96-110, 131-136`, `server/internal/api/server.go:293-309`, `websocket_browser.go:14`, `main_windows.go:163-182` | `WithAuth` ist in `server/` **definiert, aber nirgends eingebunden** (nur `backend/` nutzt es). Alle `/api/*`-Routen, `/ws` und `/ws/client` sind offen, CORS `*`, WebSocket `CheckOrigin: true`, Dienst lauscht auf `0.0.0.0`. Über `POST /api/asio/panel` (und `cmd:start`, `cmd:monitor:start`) gelangt eine **beliebige `deviceId`** zum Client; dieser macht `TrimPrefix("asio:")` und ruft `CLSIDFromString` + `CoCreateInstance(CLSCTX_INPROC_SERVER)`. Damit lässt sich jede auf dem Client registrierte In-Process-COM-Klasse laden (DLL-Load im Prozess; Treiber-Absturz = Client-Absturz). `registry.Hub(deviceID)` legt zudem unbegrenzt Hubs für fremde IDs an. Eine Webseite im LAN-Browser kann das per Cross-Origin-POST auslösen. | T407 |
| **F-30** | FR-409 / Constitution VI | MEDIUM | L | `wsclient/client.go:111-117, 135-150` | Beim Verbindungsaufbau läuft `sendDevices()` **synchron** vor Heartbeat-Goroutine und Read-Loop und probt alle ASIO-Treiber. Dauert das (viele Treiber, hängender Treiber F-16, belegter Treiber F-05) länger als der 90-s-Read-Deadline des Servers, trennt der Server, der Client verbindet neu und enumeriert erneut: eine Reconnect-Schleife. Befehle (`cmd:start`) warten bis zum Ende der Enumeration. | T408 |
| **F-27** | FR-406 | MEDIUM | P | `main_windows.go:209-216` vs. `163-182`, `asio_host.cpp:526-529` | Der Tray-Eintrag öffnet immer das Panel von `devs[0]` (keine Auswahl) mit `OpenASIOControlPanel` (asynchron). Anders als `cmd:asio:panel` stoppt er den Capturer nicht; `panel_thread_func` ruft dann `g_asio->controlPanel()` von einem **fremden Thread** auf der laufenden Treiberinstanz (STA-Objekt des Capture-Threads). Nach Panel-Änderungen wird nichts neu geöffnet. | T406 |
| **F-26** | FR-405 | MEDIUM | L | `asio_bridge.go:43-92` | `goAsioBufferCallback` hat kein `recover`. Jede Panic in Hub-/WS-Callbacks (`OnLevel` → `ws.SendMonitorLevel`, `ExtractChannelLevel`, `unsafe.Slice`) beendet den Prozess (Treiberthread, keine Go-Goroutine). Die Panic im Race-Test (`level.go:19`, `index out of range`) zeigt, wie nah das liegt, sobald Kanalzahl und Puffer auseinanderlaufen. `OnStart` hat ein `recover` (`main_windows.go:75-82`), der Callback-Pfad nicht. | T405 |
| **F-29** | Constitution III / FR-404 | LOW–MEDIUM | V (Panic im Test) / P (Praxis) | `types.go:67-81`, `hub.go:540-541, 581-585` | `SetMultiLevelCallback(func(frames, pcm))` und `SetPCMFanOutCallback(func([]byte))` liefern die Kanalzahl **nicht** mit. Der Hub rät sie aus `h.nativeCh`, das beim Capturer-Wechsel springt. Folge: Bei jeder Abweichung (spätes Callback nach Stop = F-21, Clamp auf 32 = F-19, Mono-Expansion = F-01) werden Indizes falsch oder außerhalb des Puffers berechnet (`ExtractChannelLevel` prüft `len(pcm)` nicht). | T405 |
| **F-25** | Lieferkette | LOW–MEDIUM | L | `ffmpeg/resolve_windows.go:15, 43-64, 86-104` | Ist ffmpeg nicht im PATH, lädt der Client ein ~150 MB großes ZIP von `…/FFmpeg-Builds/releases/download/latest/…` (bewegliche `latest`-URL) ohne Prüfsumme und führt es aus. Nicht ASIO-spezifisch. | T409 |

## 3. Präzisierungen früherer Findings
- **F-12** (keine Tests): Teilweise überholt. Es gibt 24 Tests (Hub, Buffer, Session), sie sind unter Linux nur wegen der `windows`-Tags nicht lauffähig. Per Overlay laufen sie, **auch mit `-race`**, und sind grün. Die Lücke bleibt: keine Tests an Bridge/Konvertierung, CI führt keine Tests aus. Dauerhafte Lösung: Build-Tags vom Hub entfernen (T410).
- **F-18/F-21** (Callback nach Stop): Die Race-Stress-Läufe zeigen, dass der Hub **nur** unter dieser Zusage stabil ist (ohne sie Panic in 2/3 Läufen). Das erhöht den Wert von T301 (In-Flight-Wartezeit) und T405 (Kanalzahl im Callback).
- **F-04**: Das Frontend bietet immer mindestens zwei Kanäle (`Math.max(2, maxInputChannels ?? 2)`, `CardSettingsPanel.tsx:234, 246`) und bei Probe-Fehlern 32; der Capturer biegt Überschreitungen still auf den letzten Kanal um.

## 4. Was geprüft wurde und in Ordnung ist
- Bestehende Hub-, Buffer- und Session-Tests: grün unter `-race`.
- Keine Data Races im Hub unter 6 Goroutinen Subscribe/StartStream/Unsubscribe plus Treiberthread (5/5 Läufe), solange keine Callbacks nach `Stop` kommen.
- Lock-Reihenfolge `startMu` → `mu` ohne Deadlock im Test; `Unsubscribe` hält `mu` nicht über `Stop()`.
- Phase-1/Phase-2-Logik in `addSub` schützt gegen konkurrierendes Ersetzen eines Subscribers.
- Die Stream-Session überlebt Capturer-Neustarts (füllt mit Stille, trennt Icecast nicht).
- Heartbeat/Deadline-Konzept im WebSocket (30 s/90 s) ist konsistent mit `CLAUDE.md`.

## 5. Konsolidierte Prioritäten (001–004)
| Prio | Befund | Warum |
|---|---|---|
| **P0** | F-23, F-01 | Falsche Kanäle bzw. falsche Dauer, beides **nachgewiesen** |
| **P0** | F-28 | Offene Schnittstelle plus fremde COM-Klasse im Client-Prozess |
| **P0** | F-20 | Lizenzfrage blockiert Veröffentlichung |
| **P1** | F-02, F-22, F-03, F-04/F-05/F-30, F-24 | Pegel/Dauerbetrieb/Reset/Geräteliste/Unterbrechungen |
| **P2** | F-14…F-19, F-21, F-25…F-27, F-29 | Robustheit und Diagnose |
| **P3** | F-07, F-08, F-10, F-11, F-13 | Hygiene, Hardware-Test nötig |

## 6. Metriken
Neue Findings: 9 (F-22 bis F-30). Severity: HIGH 2 (F-23, F-28), MEDIUM–HIGH 1 (F-22), MEDIUM 4 (F-24, F-26, F-27, F-30), LOW–MEDIUM 2 (F-25, F-29).
Nachgewiesen durch Ausführung: F-01, F-23, F-24 (Verhalten), F-29 (Panic im ungesicherten Test). Requirements 11, Tasks 11 (T401…T411), Coverage 100 % (siehe `tasks.md`).

## 7. Grenzen
- Bridge (cgo/C++) nicht ausgeführt, nur nachgebaut; jeder Hub-Test benutzt einen Mock-Capturer.
- Drift-Simulation mit angenommenem Jitter; keine Messung an echter Hardware.
- F-24-Dauer, F-27 und alle C++-Aussagen brauchen Windows.
- Server-Seite (F-28) nur aus Code gelesen, nicht gegen eine laufende Instanz getestet.

## 8. Next Actions
1. **T401** (F-23) und **T402** (F-01): Fix mit den vorhandenen roten Tests aus `repro/` als Abnahme.
2. **T407** (F-28): Auth einbinden und `deviceId` gegen die Geräteliste prüfen, vor jeder weiteren Veröffentlichung.
3. **T410/T411**: Build-Tags vom Hub entfernen und `go test ./...` in die CI, damit die Tests dauerhaft laufen.
4. **T403** (F-22): zuerst messen (Pufferstand und Underruns im Log), dann Regler einbauen.

Soll ich T401 und T402 umsetzen? Die roten Tests aus `repro/run.sh` zeigen sofort, ob die Fixes greifen.
