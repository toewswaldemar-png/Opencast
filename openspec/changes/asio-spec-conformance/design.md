# Design

## Context

Die Spezifikation verlangt (§II.7): Reset-Requests mit `1L` bestätigen und zu einem sicheren Zeitpunkt außerhalb des Callbacks neu starten; JUCE entprellt mit 500 ms. PortAudio/Ardour ignorieren Resets (Ticket #108) und sind hier kein Vorbild.

## Goals / Non-Goals

**Goals:**
- Spezifikationskonformes Verhalten ohne stille Fehler.
- Übernahme bewährter Schutzmuster (Einzelgerät-Guard, In-Flight-Wartezeit, Blacklist).

**Non-Goals:**
- Ausgabekanäle, Latenzkompensation, DSD-Wiedergabe.

## Decisions

1. **Sample-Tabelle:** eine Quelle (`typ → Bytes, Endianness, Ausrichtung, Float`), Go-Referenz mit Testvektoren, C++ daraus abgeleitet.
2. **Neustart:** Callback setzt atomar einen Grund; die Pump-Schleife wartet 500 ms und beendet mit Fehlercode; der Hub startet neu; nicht während das Panel offen ist.
3. **Überlast:** `ASIOFuture(kAsioCanReportOverload)` nach `createBuffers`; Zähler atomar; Log höchstens 1×/s.
4. **Samplerate:** Fehlercodes prüfen, Rate 0 ablehnen, tatsächliche Rate an Hub/Encoder melden.
5. **Einzelgerät:** atomarer Zeiger auf das offene Gerät; `Start()` für anderes Gerät → sofortiger Fehler.
6. **Probe:** Zeitlimit (8 s), Blacklist (PortAudio-Namen), Out-Parameter in 4096-Byte-Struktur, kein Probe während Capture.
7. **Stopp:** In-Flight-Zähler im Callback; nach `stop()` bis 2 s warten; bei Timeout Puffer nicht freigeben.
8. **COM:** Struktur `{state, threadId}` nach `PaWinUtil_CoInitialize`.
9. **Panel:** Tray-Untermenü je Gerät; immer Capture stoppen → Panel → neu öffnen.

## Risks / Trade-offs

- Alle C++-Änderungen sind nur auf Windows prüfbar (Hardware-Abnahme mit ReaRoute, UR22mkII, 24-in-32-Interface).
- Der Stopp kann bei defekten Treibern bis zu 2 s länger dauern.
