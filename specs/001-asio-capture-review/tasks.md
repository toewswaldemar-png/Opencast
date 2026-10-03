# Tasks: ASIO-Capture — Konformität herstellen

**Input**: `spec.md`, `plan.md`, `analysis.md`
**Legende**: `[P]` parallel möglich · `[Fn]` Finding aus `analysis.md` · `[US]` User Story

## Phase 1: Foundation (blockiert alles andere)
- [ ] T001 Reine Funktionen aus `asio_bridge.go`/`capturer_asio.go` extrahieren: `expandMono(src []byte, frames int) []byte`, `resolveChannels(requested []int, numInput int) ([]int, error)` in neuer Datei `client/internal/audio/asio_pure.go` (ohne Build-Tag `asio`) [F-01, F-04]
- [ ] T002 [P] Sample-Konvertierung als testbare Go-Referenz `sampleToI16(typ int, buf []byte, frame int)` in `client/internal/audio/sample.go` (ohne Tag), Tabelle aller `ASIOSampleType`-Werte [F-02]
- [ ] T003 CI: Job `go vet ./...` und `go test ./...` mit `GOOS=windows` für `client/` in `.github/workflows/` ergänzen [F-12]

## Phase 2: US1 — korrekter Stream (P1) 🎯 MVP
- [ ] T010 [US1] Test: Mono-Union (1 Kanal) liefert nach Hub-Extraktion dieselbe Frame-Zahl wie der Treiber (`client/internal/hub/hub_test.go`, rot vor Fix) [F-01]
- [ ] T011 [US1] Fix: Bridge liefert im Fan-Out-Pfad immer `nCh` interleaved Kanäle (keine Expansion); Expansion nur im `OutputCh`-Legacy-Pfad oder entfernen; Vertrag in `types.go` präzisieren [F-01]
- [ ] T012 [US1] Kanal-Validierung: out-of-range → Fehler, keine Duplikate, `openChs` = tatsächlich geöffnete Kanäle (`capturer_asio.go:140-177`) [F-04]
- [ ] T013 [US1] `asio_host.cpp`: unbekannte Sample-Typen in `asio_start_capture` ablehnen; fehlende Typen ergänzen (Int32LSB16/18/20/24, Int24MSB, Float32MSB, Float64MSB); Typ je Kanal prüfen [F-02]
- [ ] T014 [P] [US1] Tabellentest für `sampleToI16` gegen Referenzwerte, C++-Implementierung 1:1 spiegeln [F-02]

## Phase 3: US3 — Geräteliste (P2)
- [ ] T020 [US3] `asioProbeDriver`: bei belegtem Treiber ohne Cache `maxInputChannels = 0` ("unbekannt") statt 32; Frontend zeigt Hinweis [F-04, F-05]
- [ ] T021 [US3] `Start()` mit Timeout/ctx auf `asioGlobalMu`; Fehlermeldung "ASIO-Treiber belegt (Gerät X)" an UI (`capturer_asio.go:100`) [F-05]

## Phase 4: US4 — Robustheit (P2)
- [ ] T030 [US4] `asio_message`: `kAsioResetRequest`/`ResyncRequest`/`BufferSizeChange` setzen ein Flag, das die Pump-Schleife in einen kontrollierten Stop mit Fehlerstatus überführt (nicht aus dem Callback heraus neu starten); `asio_sample_rate_changed` markiert ebenfalls [F-03]
- [ ] T031 [US4] Watchdog: `callbackFired` durch Zeitstempel des letzten Callbacks ersetzen (atomic), Stall ≥ 5 s jederzeit erkennen (`capturer_asio.go:203-215`) [F-03]
- [ ] T032 [US4] Stop-Event pro Instanz: `g_stopEvent` aus Globals lösen oder Handle-Generation mitführen; `asio_stop` nur wirksam für die aktuelle Instanz [F-06]
- [ ] T033 [P] [US4] COM-Balance: `didCoInit` in `asio_open_driver`/`asio_release_driver` verfolgen wie in `asio_probe_driver` [F-07]
- [ ] T034 [US4] Control-Panel-Thread: Release und Beenden nach Schließen des Panels (Message-Loop mit Abbruchbedingung); manuell auf Hardware prüfen [F-08]
- [ ] T035 [US4] Restart-Backoff im Hub (3 s → 6 s → 12 s … max 60 s, nach N Fehlschlägen UI-Fehler, Reset bei Erfolg) (`hub.go:396-399`) [F-11]

## Phase 5: Performance (P2)
- [ ] T040 Hub-Callbacks lock-/allokationsfrei: Subscriber-Snapshot als `atomic.Pointer[[]entry]`, bei Subscribe/Unsubscribe neu aufgebaut (`hub.go:520-588`) [F-09]
- [ ] T041 Benchmark/`AllocsPerRun`-Test für den Monitor-Callback-Pfad [F-09]
- [ ] T042 [P] VU-Lücke nach Start beheben: `pcmOut` nicht als Senke nutzen, wenn kein Konsument existiert (nur FanOut oder MultiLevel) [F-10]

## Phase 6: Hygiene (P3)
- [ ] T050 [P] `backend/internal/audio/asio_host.cpp`: Entscheidung entfernen oder synchronisieren (WSAStartup fehlt dort) [F-13]
- [ ] T051 [P] `CLAUDE.md` aktualisieren: `monitor.go` → `hub/hub.go`, tatsächliche Callback-Pfade, Hinweis zu `backend/` [F-09, F-13]

## Abhängigkeiten
T001 → T010 → T011 · T002 → T013/T014 · T012 nach T001 · T030 vor T031 · T040 nach T041 (Test zuerst) · T003 früh (schützt alles danach)

## Manuelle Hardware-Abnahme (nicht automatisierbar)
ReaRoute (mit/ohne REAPER), Yamaha UR22mkII, ein 24-in-32-Interface: Mono-Stream-Dauer, Reset über Control-Panel, Gerät abziehen.
