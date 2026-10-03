# Tasks: Tiefenprüfung — Befunde beheben

**Input**: `spec.md`, `plan.md`, `analysis.md`, `research.md`, `repro/`. Legende: `[Fn]` Finding · `[FR]` Requirement. Verknüpfte Tasks aus 001–003 sind benannt.

## Phase 1: Korrektheit (P0) — Abnahme sind die roten Tests aus `repro/`
- [ ] T401 [F-23][FR-401] `hub.go`: `recomputePositions` gegen `capChs` (wenn Capturer läuft) statt `openChs`; in `Unsubscribe` (114-118), `StopMonitors` (159-162) und `addSub` Phase 1 (237-239) und Phase 2 (262-266) anwenden. Test `TestDeep_F23_UnsubscribeShiftsPositions` wird grün; zusätzlich Permutationstest (3 Subscriber, alle 6 Entfernungsreihenfolgen, Pegelprüfung je Kanal).
- [ ] T402 [F-01][FR-401] Bridge/Hub: keine Mono-Expansion im Fan-Out-Pfad (`asio_bridge.go:63-79`); `ExtractStereoBytes` übernimmt `posL == posR`. `TestDeep_F01_MonoStreamFrameCount` wird grün. *Setzt T010/T011 aus 001 um; Bridge-Mock im Test muss nachgezogen werden.*

## Phase 2: Testbarkeit und CI
- [ ] T410 [F-12][FR-411] Build-Tags entfernen: `hub.go`, `registry.go`, `hub_test.go`; `ffmpeg/resolve_windows.go` → `resolve.go` (Download nur unter Windows, sonst `LookPath`-Fehler); `audio.NewCapturer` für Nicht-Windows als Fehler-Stub. Danach `go test -race ./...` unter Linux ohne Overlay.
- [ ] T411 [F-12][FR-411] Die Tests aus `repro/hub_deep_test.go.txt` und `pcmbuffer_drift_test.go.txt` als reguläre Tests übernehmen (`hub_asio_test.go`, `drift_test.go`; Drift-Test als Regressionstest mit Schwellwert, nicht als Log-Tabelle). CI-Job `go vet` + `go test -race ./...` für `client/` (Linux) in `.github/workflows/`. *Ersetzt T003 aus 001.*

## Phase 3: Sicherheit (P0)
- [ ] T407 [F-28][FR-407][FR-408] `server/main.go`: `api.WithAuth(auth.NewTokenAuth(token))` für `/api/*`, `/ws`, `/ws/client` (Token aus ENV/Config; Browser sendet Token); CORS/`CheckOrigin` auf konfigurierte Origins. Client: `deviceId` gegen die letzte Geräteliste prüfen (`cmd:start`, `cmd:monitor:start`, `cmd:asio:panel`), `registry.Hub` nur für bekannte IDs, `asio:`-Präfix und CLSID-Format (`{8-4-4-4-12}`) validieren. Test: unbekannte ID wird abgelehnt, ohne COM-Aufruf.
- [ ] T408 [F-30][FR-409] `wsclient/client.go:117`: Geräteliste asynchron nach Heartbeat-Start; bei laufendem Capture nur Cache (`T305` aus 003).

## Phase 4: Robustheit
- [ ] T405 [F-26][F-29][FR-404][FR-405] `types.go`/`asio_bridge.go`/`hub.go`: Callback-Signaturen mit `nCh`; Hub verwirft Puffer mit falscher Länge; `goAsioBufferCallback` mit `defer recover()` (Zähler, Log höchstens 1×/s). Test: Puffer falscher Länge → kein Panic.
- [ ] T406 [F-27][FR-406] `main_windows.go`: Tray-Menü je ASIO-Gerät (Untermenü) oder Auswahl; Panel immer über den Ablauf von `OnAsioPanel` (Capturer stoppen → Panel → neu öffnen). *Verknüpft mit T034 aus 001.*
- [ ] T409 [F-25][FR-410] ffmpeg-Download: feste Version, SHA-256-Prüfung, Hinweis im Log; Umgebungsvariable zum Abschalten.

## Phase 5: Takt und Unterbrechungen
- [ ] T403 [F-22][FR-403] **Erst messen**: im Session-Ticker Pufferstand, Underruns, Overflows je Minute loggen und auf echter Hardware (UR22mkII, ReaRoute) 1 h mitschreiben. Dann Regler (Zielstand 3–4 Frames, Vorfüllung, PI-Nachführung der Tickperiode) und `drift_test` mit Schwelle ≤ 2 Glitches/h bei ±100 ppm.
- [ ] T404 [F-24][FR-402] Entscheidung (a) alle Kanäle öffnen oder (b) Monitor wartet; danach Umsetzung und Test `TestDeep_F24` anpassen (erwartet 1 Capturer-Start).

## Abhängigkeiten
T401, T402 zuerst (rote Tests vorhanden) · T410 vor T411 · T407 unabhängig, vor der nächsten Veröffentlichung · T405 nach T402 (gleiche Signaturen) · T403 nach Messung · T404 nach Entscheidung.

## Coverage
FR-401 T401, T402 · FR-402 T404 · FR-403 T403 · FR-404 T405 · FR-405 T405 · FR-406 T406 · FR-407 T407 · FR-408 T407 · FR-409 T408 · FR-410 T409 · FR-411 T410, T411 → 11/11.

## Manuelle Abnahme (Windows/Hardware)
1. ReaRoute, zwei Karten auf Kanal 1/2 und 3/4: Karte 1 stoppen — Karte 2 behält ihr Signal (F-23).
2. Mono-Stream (L==R) über 5 min: Dauer gleich Wanduhr, Tonhöhe korrekt (F-01).
3. Stream läuft, Monitor auf anderem Paar starten: keine Lücke (F-24).
4. 1-h-Stream: Underruns/Overflows laut Log ≤ 2 (F-22).
5. Unbekannte `deviceId` per `curl` an `/api/asio/panel`: 401/abgelehnt (F-28).
