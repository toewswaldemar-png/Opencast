# level-monitoring Specification

## Purpose
Beschreibt die Pegelanzeige (VU) für Karten ohne und mit laufendem Stream.

## Requirements

### Requirement: Monitor starten
Der Server SHALL `POST /api/monitor/start` mit `monitorId`, Gerät, Samplerate und Kanälen annehmen und dem Client `cmd:monitor:start` senden.

#### Scenario: Monitor einer Karte
- **WHEN** ein Monitor für eine Karte gestartet wird
- **THEN** sendet der Server `cmd:monitor:start` mit den Parametern

### Requirement: Kein Monitor bei laufendem Stream
Läuft für dieselbe `monitorId` ein Stream, SHALL der Server den Monitor-Start mit HTTP 200 quittieren, ohne den Client anzusprechen.

#### Scenario: Stream aktiv
- **WHEN** die Karte bereits streamt
- **THEN** wird kein `cmd:monitor:start` gesendet

### Requirement: Globaler Stopp mit Karenzzeit
Ein globaler Monitor-Stopp SHALL erst nach 300 ms an den Client gesendet werden; trifft in dieser Zeit ein Start mit identischer Konfiguration ein, SHALL der Stopp verworfen werden.

#### Scenario: Browser-Reload
- **WHEN** nach einem globalen Stopp innerhalb von 300 ms derselbe Monitor erneut startet
- **THEN** wird der Client nicht angesprochen und der Monitor läuft weiter

### Requirement: Stopp je Karte
Ein Stopp mit `monitorId` SHALL sofort als `cmd:monitor:stop` an den Client gehen.

#### Scenario: Einzelner Stopp
- **WHEN** `POST /api/monitor/stop` mit `monitorId` eintrifft
- **THEN** wird `cmd:monitor:stop` sofort gesendet

### Requirement: Pegelwerte
Pegel SHALL in dBFS mit Untergrenze −120 gemeldet und höchstens etwa alle 33 Millisekunden pro Subscriber gesendet werden.

#### Scenario: Stille
- **WHEN** das Signal Null ist
- **THEN** wird −120 dBFS gemeldet
