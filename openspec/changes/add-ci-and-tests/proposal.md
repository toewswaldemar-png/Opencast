# Proposal

## Why

Es gibt keine Prüfung bei Pull Requests außer dem Docker-Build; `go vet`, `go test` und die Frontend-Typprüfung laufen nirgends. `server/` hat keine einzige Testdatei, die Client-Tests (24) laufen nur unter Windows (Build-Tag `windows` an Hub, Registry und ffmpeg-Resolver), obwohl die Logik plattformunabhängig ist. Die Client-Kompilierung wird erst beim Release-Tag geprüft. Ein Overlay-Lauf unter Linux (`-race`) zeigte, dass die bestehenden Tests dort laufen und grün sind. Das eingecheckte `server/dist` weicht vom aktuellen Frontend-Build ab (302 470 vs. 302 799 Byte JS).

## What Changes

- Pull-Request-Workflow: Server (`vet`, `test -race`, Build), Frontend (`tsc`, Build), Client (`GOOS=windows vet`, Build; Linux-Tests der Kernlogik), ASIO-Build in einem Windows-Job.
- Build-Tags vom Hub entfernen; `ffmpeg`-Resolver plattformneutral.
- Erste Server-Tests: die Szenarien der OpenSpec-Basisspezifikationen.
- ffmpeg-Download mit Versionspin und Prüfsumme.
- `server/dist` nicht einchecken oder in CI verifizieren.

## Capabilities

### New Capabilities


### Modified Capabilities
- `packaging-release`: Pull-Request-Prüfung, testbare Kernlogik, Server-Tests, ffmpeg-Beschaffung, Frontend-Artefakt.

## Impact

.github/workflows, `client/internal/hub/*`, `client/internal/ffmpeg`, `client/internal/audio/*` (NewCapturer-Stub), `server/**/*_test.go`, `.gitignore`. Vorlage: `specs/005-opencast-full-review/repro/server_conformance_test.go.txt`.
