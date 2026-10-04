# Spec Delta

## ADDED Requirements

### Requirement: Konsistenter Online-Zustand
Beim Ersetzen einer Client-Verbindung SHALL der Server den Browsern genau den Zustand "verbunden" melden; der Abbau der ersetzten Verbindung SHALL kein `clientOnline=false` auslösen.

#### Scenario: Reconnect vor Erkennung der Trennung
- **WHEN** ein neuer Client verbindet, während die alte Verbindung noch offen ist
- **THEN** zeigt der Browser nach Abschluss `clientOnline=true`

### Requirement: Zustand nach Trennung
Nach dem Verlust des Windows-Clients SHALL der Server die gemerkte Geräteliste und die Stream-Status verwerfen, sodass `GET /api/status` keine laufenden Streams mehr meldet.

#### Scenario: Client getrennt
- **WHEN** der Client die Verbindung verliert
- **THEN** meldet `GET /api/status` `clientConnected=false` und eine leere Stream-Liste

### Requirement: Verbindungsaufbau ohne Blockade
Der Client SHALL Heartbeat und Nachrichtenschleife unmittelbar nach dem Verbindungsaufbau starten, unabhängig von der Dauer der Geräteaufzählung.

#### Scenario: Langsame Aufzählung
- **WHEN** die Aufzählung länger als 90 Sekunden dauert
- **THEN** bleibt die Verbindung bestehen
