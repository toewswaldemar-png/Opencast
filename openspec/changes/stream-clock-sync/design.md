# Design

## Context

`runTicker` liest alle `frameDuration` ein Frame (`time.Ticker`); der Producer schreibt in Treiber-Bursts. Bei leerem Puffer wird Stille eingefügt, bei vollem das älteste Frame verworfen.

## Goals / Non-Goals

**Goals:**
- Keine hörbaren Lücken bei realistischen Taktabweichungen.
- Latenz bleibt unter 50 ms im Regelbetrieb.

**Non-Goals:**
- Resampling mit Qualitätsanspruch; Änderungen am Encoder.

## Decisions

1. **Regler:** PI-Regler auf den geglätteten Pufferstand; stellt die Tickperiode in Schritten von ±0,05 % (max. ±0,2 %) nach.
2. **Vorfüllung:** erster Tick erst bei Zielstand oder nach 200 ms.
3. **Alternative (zu prüfen):** Zuführung getaktet durch den Capturer (Callback-getrieben), Wanduhr nur für Stille bei Ausfall.
4. **Messung zuerst:** Pufferstand/Underruns auf echter Hardware 1 Stunde mitschreiben, bevor der Regler eingebaut wird.

## Risks / Trade-offs

- Falsch abgestimmter Regler kann schwingen; die Simulation wird Regressionstest.
