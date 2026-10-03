# Implementation Plan: Tiefenprüfung — Behebung der nachgewiesenen Befunde

**Spec**: [spec.md](./spec.md) | **Analyse**: [analysis.md](./analysis.md) | **Repro**: [repro/run.sh](./repro/run.sh) | **Constitution**: v1.1.0

## Technical Context
- Go 1.22 (Client/Server), CGO nur im ASIO-Teil. Der Hub ist reine Go-Logik und wird **plattformunabhängig** gemacht.
- Abnahme: `repro/run.sh` (Fehlschläge F-01/F-23 werden grün), danach dieselben Tests dauerhaft im Repo (ohne Overlay).

## Constitution Check
| Prinzip | Status |
|---|---|
| III Kanalsemantik | ✗ F-23, F-01, F-29 |
| VI Sichtbare Ausfälle | ⚠ F-22 (stille Glitches), F-30 |
| VII Testbarkeit | ✗ Hub nur unter Windows testbar (F-12, T410) |
| IX/neu Sicherheit | ✗ F-28 — Vorschlag: Prinzip X "Befehle sind authentifiziert und validiert" (Constitution-Änderung separat) |

## Entscheidungen
- **F-23**: Positionen immer relativ zu `capChs` (der tatsächlichen Kanalfolge des laufenden Capturers). `recomputePositions` bekommt `capChs` als Referenz, solange `h.cap != nil`; `openChs` bleibt "gewünschte Union" und löst nur den Neustart aus. Nach Neustart: `capChs = openChs`.
- **F-01**: Bridge liefert im Fan-Out-Pfad immer die rohen `nCh` Kanäle (keine Mono-Expansion); die Expansion zu Stereo geschieht ausschließlich in `ExtractStereoBytes` (`posL == posR`). Der `OutputCh`-Legacy-Pfad behält sie.
- **F-29**: Callbacks bekommen die Kanalzahl: `func(frames, nCh int, pcm []int16)` und `func(nCh int, pcm []byte)`; der Hub validiert `len == frames*nCh*2` und verwirft sonst.
- **F-22**: Pufferstandsregler im Session-Ticker: Zielstand 3–4 Frames, Vorfüllung bis Zielstand vor dem ersten Tick, Tickperiode wird in ±0,05 % Schritten nachgeführt (PI-Regler auf den geglätteten Stand); Metriken (Underruns/Overflows/Stand) im Log. Alternative (zu prüfen): Capture-getaktete Zuführung statt Wanduhr, Stille nur bei Ausbleiben der Daten.
- **F-24**: Entscheidung des Maintainers: (a) bei laufendem Stream **alle** Gerätekanäle öffnen (Ardour-Muster, kein Neustart, etwas mehr CPU), oder (b) Monitor auf nicht geöffnete Kanäle meldet "erst nach Stream-Stop verfügbar". Empfehlung: (a) mit Obergrenze (z. B. 32 Kanäle), per Konstante abschaltbar.
- **F-28**: `WithAuth` für `/api`, `/ws`, `/ws/client`; Token aus Konfiguration/ENV; CORS/Origin auf konfigurierte Origins; im Client Allowlist der enumerierten Geräte-IDs (`registry.Hub` nur für bekannte IDs).
- **F-30**: `sendDevices` in eigener Goroutine nach Heartbeat-Start; bei laufendem Capture nur Cache.
- **T410**: `//go:build windows` von `hub.go`, `registry.go`, `hub_test.go` und `ffmpeg/resolve_windows.go` (umbenennen in `resolve.go`, Download hinter `runtime.GOOS`) entfernen; `audio.NewCapturer` für Nicht-Windows als Fehler-Stub. CI: `go vet` + `go test -race ./...` unter Linux.

## Phasen
1. **Korrektheit** (T401, T402) mit den roten Tests als Abnahme.
2. **Testbarkeit/CI** (T410, T411): die Tests aus `repro/` als reguläre Tests übernehmen.
3. **Sicherheit** (T407, T408).
4. **Robustheit** (T405, T406, T409).
5. **Takt** (T403) nach Messung; **Unterbrechungen** (T404) nach Entscheidung.

## Risiken
- T401: Positionen relativ zu `capChs` erfordern, dass alle Aufrufer von `recomputePositions` den Stand von `capChs` unter `h.mu` sehen; Test: 3 Subscriber, jede Entfernungsreihenfolge (6 Permutationen).
- T403: Regler darf bei Drift 0 keine Schwebung erzeugen; Simulation (`pcmbuffer_drift_test`) wird Regressionstest.
- T404(a): Manche Treiber begrenzen die Zahl gleichzeitig offener Kanäle — Fallback auf Union.
