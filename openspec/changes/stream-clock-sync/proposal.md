# Proposal

## Why

Simulation mit dem echten `PCMBuffer` (Spec Kit 004, F-22): Der Wanduhr-Ticker der Stream-Session und der Geräte-Takt laufen ohne Regelung. Bei 50 ppm Abweichung entsteht alle etwa 106 s ein Underrun (eingefügte Stille von 5,3 ms, hörbar als Knacken), bei 100 ppm doppelt so oft; in Gegenrichtung wächst die Latenz bis etwa 267 ms, danach werden Frames verworfen. Eine Vorfüllung ändert daran nichts.

## What Changes

- Die Stream-Session regelt den Pufferstand auf einen Zielwert (3 bis 4 Frames) und füllt vor dem ersten Tick vor.
- Underruns, Overflows und Pufferstand werden minütlich geloggt.
- Abnahme: höchstens 2 Glitches pro Stunde bei ±100 ppm.

## Capabilities

### New Capabilities


### Modified Capabilities
- `audio-capture-hub`: Takt der Stream-Session, Pufferstandsregelung.

## Impact

`client/internal/streamsession/session.go`, `client/internal/pcmbuffer`. Reproduktion: `specs/004-opencast-asio-deep-review/repro/run.sh` (Abschnitt 3).
