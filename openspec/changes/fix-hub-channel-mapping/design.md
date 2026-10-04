# Design

## Context

`openChs` ist die gewünschte Vereinigung, `capChs` die geöffnete Kanalfolge des laufenden Capturers. Callbacks lesen `h.nativeCh`, das beim Capturer-Wechsel springt.

## Goals / Non-Goals

**Goals:**
- Richtige Kanäle in jedem Zustand (6 Entfernungsreihenfolgen bei 3 Subscribern).
- Frames am Ausgang = Frames am Eingang.
- Keine Unterbrechung eines laufenden Streams durch Monitore.

**Non-Goals:**
- Änderung der Treiber-Open-Strategie außerhalb der Kanalöffnung; ASIO-Reset-Behandlung (eigene Änderung).

## Decisions

1. `recomputePositions` erhält `capChs` als Referenz, solange ein Capturer läuft; `openChs` löst nur den Neustart aus.
2. Bridge: keine Mono-Expansion im Fan-Out-Pfad; `ExtractStereoBytes` übernimmt `posL == posR`. Der `OutputCh`-Pfad behält sie.
3. Callback-Signaturen: `func(frames, nCh int, pcm []int16)` und `func(nCh int, pcm []byte)`; Hub prüft `len == frames*nCh*2`.
4. Monitore auf Kanälen außerhalb von `capChs` bei laufendem Stream: **Entscheidung offen** — (a) alle Gerätekanäle öffnen (Ardour-Muster), (b) Monitor wartet bis zum Stream-Ende. Empfehlung (a) mit Obergrenze 32 Kanäle.

## Risks / Trade-offs

- (a) kostet etwas CPU/Speicher und scheitert bei Treibern mit Kanalgrenze (Fallback auf Vereinigung).
- Signaturänderung betrifft `hub_test.go` und die Mocks.
