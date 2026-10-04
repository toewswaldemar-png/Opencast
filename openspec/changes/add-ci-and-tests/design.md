# Design

## Context

Der Overlay-Lauf unter Linux belegt, dass Hub und Session ohne Windows testbar sind; nur `audio.NewCapturer` und der ffmpeg-Resolver brauchen eine Nicht-Windows-Variante.

## Goals / Non-Goals

**Goals:**
- Jeder PR läuft durch Prüfung und Tests.
- Kernlogik unter Linux testbar.

**Non-Goals:**
- Hardware-Tests automatisieren.

## Decisions

1. `hub.go`, `registry.go`, `hub_test.go`: Tag entfernen; `audio.NewCapturer` für Nicht-Windows als Fehler-Stub; `ffmpeg/resolve_windows.go` → `resolve.go` (Download nur unter Windows).
2. Workflow `ci.yml`: Jobs `server`, `frontend`, `client-linux` (Tests mit `-race`), `client-windows` (Build WASAPI), `client-asio` (Windows, SDK-Secret).
3. Server-Tests aus `server_conformance_test.go.txt` übernehmen; Befund-Tests (S1, S2, S3, W1, R1, C1) erst nach den Fixes grün.
4. ffmpeg: feste Version, SHA-256 im Code, Abbruch bei Abweichung; Umgebungsvariable zum Abschalten.
5. `server/dist` aus Git entfernen (`.gitignore`), Release/Docker bauen es ohnehin.

## Risks / Trade-offs

- Der ASIO-Job braucht das SDK-Secret; für Fork-PRs entfällt er.
- Das Entfernen von `server/dist` bricht lokale `go build`-Aufrufe ohne vorherigen Frontend-Build (dokumentieren, `make`-Ziel).
