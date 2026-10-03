# Implementation Plan: ASIO-Host-Konformität

**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md) | **Constitution**: v1.1.0
**Art**: Plan zur Behebung der Abweichungen aus `analysis.md`; baut auf Phase 1 aus `001-asio-capture-review/plan.md` auf.

## Technical Context
- Go 1.22 + C++ (CGO, `-tags asio`), Windows x64, MinGW, ASIO SDK 2.3.x
- Nicht automatisch testbar: Treiberverhalten. Testbar: Konvertierung (reine Funktion), Reset-Zustandsmaschine (Mock), Probe-Timeout (Mock).
- Entwicklungsumgebung hier: Linux, `GOOS=windows go vet` ohne ASIO-Tag.

## Constitution Check (v1.1.0)
| Prinzip | Status |
|---|---|
| IV Sample-Formate | ✗ F-02 |
| VI Sichtbare Ausfälle | ✗ F-03, F-14 |
| VIII Spec normativ | ⚠ F-15, F-17 (Abweichungen ohne dokumentierten Grund) |
| IX Lizenz geklärt | ✗ F-20 |
| II Lebenszyklus | ⚠ F-16 |

## Entscheidung (Design)
- **Konvertierung**: Eine Tabelle `ASIOSampleType → {bytes, endian, alignBits, isFloat}` als einzige Quelle. Go-Referenzimplementierung (getestet) und C++-Implementierung werden daraus abgeleitet; ein Test vergleicht beide über Testvektoren (Vektoren als Datei, von beiden Seiten gelesen).
- **Reset**: Der Callback setzt nur ein atomares Flag `g_resetReason` und gibt `1L` zurück. Die Pump-Schleife (`asio_run_message_pump`) erkennt das Flag, wartet 500 ms (Entprellung, Muster JUCE) und beendet sich mit Fehlercode "Reset angefordert". Der Hub-Watcher startet daraufhin neu (bestehender Pfad), jedoch ohne den 3-s-Backoff, wenn die Ursache "Reset" ist.
- **Overload**: `ASIOFuture(kAsioCanReportOverload)` nach `createBuffers`; Zähler atomar, Log höchstens 1×/s.
- **Probe**: Timeout im Go-Teil (Goroutine + `select` mit `time.After`), Blacklist-Liste in `config`, Ergebnis "unbekannt" bei Timeout.
- **Lizenz**: Entscheidung des Maintainers; danach `LICENSE`, README-Abschnitt, ggf. Release-Job anpassen.

## Phasen
1. Entscheidung F-20 (Lizenz) — parallel zu allem.
2. Sample-Tabelle + Tests (T201, T202) — ohne Hardware prüfbar.
3. Reset-Zustandsmaschine (T203) + Overload (T204) — Hardware-Abnahme.
4. Samplerate-Semantik (T205), Probe-Sicherheit (T206).
5. Restpunkte (T207–T209).

## Risiken
- ReaRoute reagiert evtl. empfindlich auf Änderungen an `outputReady` (T207): vor einer Änderung zuerst Verhalten dokumentieren, dann entscheiden.
- C++-Änderungen ohne MinGW/SDK hier nicht kompilierbar; jede Änderung wird nur im Windows-CI-Job gebaut.
