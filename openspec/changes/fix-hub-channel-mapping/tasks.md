# Tasks

## 1. Tests zuerst
- [ ] 1.1 `repro/hub_deep_test.go.txt` (F-23, F-01, F-24) als reguläre Tests übernehmen (rot)
- [ ] 1.2 Permutationstest: 3 Subscriber, alle Entfernungsreihenfolgen, Pegelprüfung je Kanal

## 2. Umsetzung
- [ ] 2.1 `recomputePositions` gegen `capChs` (Unsubscribe, StopMonitors, addSub Phase 1/2)
- [ ] 2.2 Mono-Expansion aus dem Fan-Out-Pfad entfernen
- [ ] 2.3 Callback-Signaturen mit `nCh`, Längenprüfung, `recover` im cgo-Callback
- [ ] 2.4 Entscheidung (a)/(b) treffen und umsetzen
- [ ] 2.5 Kanalvalidierung: außerhalb 1..maxInputChannels → Fehler, keine Duplikate

## 3. Abnahme
- [ ] 3.1 Alle Tests grün, `-race` sauber
- [ ] 3.2 Hardware: ReaRoute mit zwei Karten, Karte 1 stoppen — Karte 2 behält Signal
