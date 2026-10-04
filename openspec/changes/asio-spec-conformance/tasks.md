# Tasks

## 1. Konvertierung
- [ ] 1.1 Sample-Tabelle und Go-Referenz mit Testvektoren (alle 16 PCM-/Float-Typen)
- [ ] 1.2 C++-Konvertierung ableiten, Typ je Kanal, unbekannte Typen ablehnen

## 2. Treibernachrichten
- [ ] 2.1 Neustart-Zustandsmaschine (Reset, Resync, BufferSizeChange, sampleRateDidChange, `kSampleRateChanged`)
- [ ] 2.2 Überlast (`kAsioCanReportOverload`, `kAsioOverload`), `kAsioSelectorSupported` ergänzen
- [ ] 2.3 Stall-Erkennung über die gesamte Laufzeit (Zeitstempel statt Einmal-Flag)

## 3. Samplerate und Kanäle
- [ ] 3.1 Rückgabecodes auswerten, Rate 0 ablehnen
- [ ] 3.2 Kanalvalidierung (siehe `fix-hub-channel-mapping`)

## 4. Robustheit
- [ ] 4.1 Einzelgerät-Guard mit sofortigem Fehler
- [ ] 4.2 Probe: Zeitlimit, Blacklist, kein Probe im Capture, Cache statt erfundener 32 Kanäle
- [ ] 4.3 In-Flight-Zähler und Wartezeit nach `stop()`
- [ ] 4.4 COM-Hilfe, Panel-Thread beenden, Tray-Panel über gemeinsamen Ablauf

## 5. Abnahme
- [ ] 5.1 Hardware-Lauf: ReaRoute mit/ohne REAPER, UR22mkII Pufferwechsel, 24-in-32-Interface, externe Clock
