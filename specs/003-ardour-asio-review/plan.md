# Implementation Plan: Lehren aus Ardour/PortAudio in Opencast umsetzen

**Spec**: [spec.md](./spec.md) | **Analyse**: [analysis.md](./analysis.md) | **Constitution**: v1.1.0
**Art**: Plan nur für die **übernehmenswerten** Muster (L-1 bis L-9) und den neuen Befund F-21; "nicht übernehmen" (N-1 bis N-5) bleibt in `002`.

## Technical Context
- Go 1.22 + C++ (CGO, `-tags asio`), Windows x64; hier keine Kompilierbarkeit des ASIO-Teils.
- Gemeinsame Grundlage: Tasks aus `001` (T020, T021, T033, T034, T208) und `002` (T201-T211) bleiben bestehen; `003` ergänzt nur, was dort fehlt.

## Constitution Check
| Prinzip | Beitrag von 003 |
|---|---|
| II Lebenszyklus | F-21 (nachlaufender Callback), L-1, L-8 |
| VI Sichtbare Ausfälle | L-1 (klarer Fehler statt Blockieren), L-6 (Rate-Abgleich) |
| VIII Spec normativ | N-1…N-3: Referenz-Hosts dürfen die Spec nicht unterschreiten |

## Entscheidungen
- **In-Flight-Schutz (T301)**: atomarer Zähler `g_inCallback` im C++-Callback (`++` am Eintritt, `--` bei jedem Ausgang); nach `stop()` bis zu 2 s warten (wie PortAudio), danach erst `disposeBuffers()`/`free`. Bei Timeout loggen und `g_pcmBuf` bewusst **nicht** freigeben (Leak statt Use-after-free).
- **Einzelgerät-Guard (T304)**: `atomic.Pointer[string]` für das offene Gerät; `Start()` für anderes Gerät → sofortiger Fehler mit Gerätenamen.
- **Probe im Capture (T305)**: `asioEnumerateDrivers` liefert bei laufendem Capture ausschließlich Cache-Werte mit Markierung `fromCache`; ohne Cache `maxInputChannels = 0` ("unbekannt").
- **COM-Hilfe (T302)**: kleine C-Struktur `{state, threadId}` nach Vorbild `PaWinUtil_CoInitialize`; `open`/`release`/Panel/Probe nutzen sie einheitlich.

## Phasen
1. T301, T304, T305 (klein, unabhängig).
2. T302, T306, T303.
3. T307 (Dokumentation der "nicht übernehmen"-Liste in `CLAUDE.md`).

## Risiken
- T301 verlängert den Stop um bis zu 2 s bei defekten Treibern; nur im Fehlerfall.
- T305 verändert die UI-Anzeige ("unbekannt"): Frontend muss `maxInputChannels = 0` verkraften.
