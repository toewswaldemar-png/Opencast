# Implementation Plan: ASIO-Capture — Konformität herstellen

**Spec**: [spec.md](./spec.md) | **Constitution**: `.specify/memory/constitution.md`
**Art**: Ist-Zustand dokumentiert (as-built) + Plan zur Behebung der Abweichungen aus `analysis.md`.

## Technical Context
- **Sprache**: Go 1.22 (Client), C++ (`asio_host.cpp`, CGO, `-tags asio`), MinGW + ASIO SDK
- **Plattform**: Windows 10/11 x64; Entwicklung hier unter Linux nur per `GOOS=windows go vet` ohne ASIO-Tag
- **Tests**: `client/internal/hub/hub_test.go` (Mocks), `pcmbuffer`. Kein Test im Paket `audio`.
- **Nicht prüfbar in dieser Sitzung**: echtes Treiberverhalten, `-tags asio` Kompilierung (kein MinGW, kein SDK)

## Constitution Check
| Prinzip | Status | Bemerkung |
|---|---|---|
| I Audio-Thread | ⚠ | Hub-Callbacks nehmen `h.mu` und allokieren (F-09) |
| II Lebenszyklus | ⚠ | globales `g_stopEvent`, COM-Balance, zweites Gerät blockiert (F-05/06/07) |
| III Kanalsemantik | ✗ | Mono-Frame-Verdopplung (F-01), stilles Clamping (F-04) |
| IV Sample-Formate | ✗ | Fallback auf Int32LSB (F-02) |
| V Dokumentierte Eigenheiten | ⚠ | CLAUDE.md verweist auf `monitor.go`, das im Client nicht existiert (F-09) |
| VI Sichtbare Ausfälle | ⚠ | Reset-Requests ignoriert, Stall nur 5 s nach Start (F-03/11) |
| VII Testbarkeit | ✗ | Keine Tests an der Bridge, CI nur Build (F-12) |

## Ist-Architektur
```
ASIO-Treiber ─▶ asio_buffer_switch (C++, ASIO-Thread)
                 ├─ Konvertierung → g_pcmBuf (int16, interleaved, nCh)
                 ├─ outputReady()
                 └─▶ goAsioBufferCallback (asio_bridge.go)
                      ├─ Monitor: multiLevelCb → Hub.buildMultiLevelCb (h.mu, alloc)
                      └─ Stream:  Mono→Stereo-Expansion, sendPCM → Hub.buildFanOutCb
                                   → ExtractStereoBytes (nativeCh) → PCMBuffer → StreamSession
Hub: ein Capturer je Gerät, Kanal-Union, Watcher-Neustart nach 3 s
```

## Soll-Änderungen (Phasen)
1. **Korrektheit (P1)**: Mono-Expansion und `nativeCh` vereinheitlichen; Sample-Typen vollständig; Kanal-Validierung.
2. **Robustheit (P2)**: `asio_message`, Stall-Watchdog, Stop-Event pro Instanz, COM-Balance, Panel-Thread, Zweitgerät-Fehler, Restart-Backoff.
3. **Performance (P2)**: Hub-Callbacks ohne Lock/Alloc im Monitor-Modus (Snapshot per `atomic.Pointer`).
4. **Qualität (P2)**: Reine Funktionen auslagern, Tests, CI `go vet`/`go test` mit `GOOS=windows`.
5. **Hygiene (P3)**: `backend/` angleichen oder entfernen, `CLAUDE.md` aktualisieren.

## Risiken
- Alle Änderungen an `asio_host.cpp` sind ohne Windows-Hardware nur eingeschränkt prüfbar; jede braucht einen manuellen Testlauf (ReaRoute + UR22mkII).
