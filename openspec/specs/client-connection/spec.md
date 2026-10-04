# client-connection Specification

## Purpose
Beschreibt das WebSocket-Protokoll zwischen Server und Windows-Client (`/ws/client`), einschließlich Befehlen, Herzschlag und Zustandsmeldungen.

## Requirements

### Requirement: Ein Windows-Client
Der Server SHALL genau einen Windows-Client gleichzeitig verwalten; eine neue Verbindung ersetzt die bisherige.

#### Scenario: Zweite Verbindung
- **WHEN** sich ein zweiter Client verbindet
- **THEN** wird die erste Verbindung geschlossen und die zweite aktiv

### Requirement: Befehle an den Client
Der Server SHALL dem Client die Befehle `cmd:start`, `cmd:stop`, `cmd:monitor:start`, `cmd:monitor:stop` und `cmd:asio:panel` als JSON-Textnachrichten senden.

#### Scenario: Client nicht verbunden
- **WHEN** kein Client verbunden ist
- **THEN** liefert das Senden `false` und der Aufrufer meldet HTTP 503

### Requirement: Herzschlag
Der Server SHALL eine Leselücke von 90 Sekunden als Verbindungsabbruch werten; der Client SHALL alle 30 Sekunden eine `heartbeat`-Textnachricht senden, der Server alle 30 Sekunden einen Ping.

#### Scenario: Leerlauf
- **WHEN** der Client 30 Sekunden nichts anderes sendet
- **THEN** sendet er `heartbeat` und die Verbindung bleibt offen

#### Scenario: Stille
- **WHEN** 90 Sekunden keine Nachricht eintrifft
- **THEN** schließt der Server die Verbindung

### Requirement: Zustandsmeldungen vom Client
Der Server SHALL `devices`, `stream:level`, `monitor:level`, `stream:status` und `stream:error` vom Client entgegennehmen und an die Browser weiterleiten; ein `stream:error` SHALL zusätzlich den Relay-Eintrag der Stream-ID entfernen.

#### Scenario: Streamfehler
- **WHEN** der Client `stream:error` für eine `streamId` meldet
- **THEN** wird der Stream deregistriert und der Fehler an alle Browser gesendet

### Requirement: Nachrichtengröße
Der Server SHALL Client-Nachrichten auf 64 KiB begrenzen.

#### Scenario: Zu große Nachricht
- **WHEN** der Client eine Nachricht über 64 KiB sendet
- **THEN** wird die Verbindung beendet
