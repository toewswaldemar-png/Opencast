# Spec Delta

## ADDED Requirements

### Requirement: Pufferstandsregelung
Die Stream-Session SHALL den Pufferstand auf einen Zielwert von 3 bis 4 Frames regeln und vor dem ersten Takt vorfüllen, sodass Taktabweichungen bis ±200 ppm höchstens zwei hörbare Lücken pro Stunde verursachen.

#### Scenario: Interface 100 ppm langsamer
- **WHEN** der Gerätetakt 100 ppm hinter der PC-Uhr liegt und eine Stunde gestreamt wird
- **THEN** treten höchstens 2 Underruns auf

#### Scenario: Interface 100 ppm schneller
- **WHEN** der Gerätetakt 100 ppm vor der PC-Uhr liegt
- **THEN** wächst die Latenz nicht über das Doppelte des Zielstands und es werden höchstens 2 Frames verworfen

### Requirement: Pufferkennzahlen
Die Stream-Session SHALL Underruns, Overflows und Pufferstand mindestens einmal pro Minute ins Log schreiben.

#### Scenario: Laufender Stream
- **WHEN** ein Stream läuft
- **THEN** enthält das Log pro Minute eine Zeile mit den drei Kennzahlen

## MODIFIED Requirements

### Requirement: Takt der Stream-Session
Die Stream-Session SHALL die Frames im Takt einer Wanduhr (Frame-Dauer = 256 Samples / Samplerate) an den Encoder geben, die Tickperiode zur Pufferstandsregelung geringfügig nachführen und die Icecast-Verbindung sofort beim Start öffnen.

#### Scenario: Session startet
- **WHEN** eine Stream-Session startet
- **THEN** wird der Encoder gestartet und der Ingest sofort geöffnet, auch wenn noch kein Audio vorliegt
