# browser-realtime Specification

## Purpose
Beschreibt den Echtzeitkanal `/ws` zwischen Server und Browser (Pegel, Status, Fehler, Client-Zustand, Geräteliste).

## Requirements

### Requirement: Nachrichtentypen
Der Server SHALL an Browser die Nachrichtentypen `level`, `status`, `error`, `clientOnline` und `devices` als JSON `{type, payload}` senden.

#### Scenario: Pegel
- **WHEN** der Client einen Pegel meldet
- **THEN** erhalten alle verbundenen Browser eine `level`-Nachricht

### Requirement: Anfangszustand
Der Server SHALL einem neuen Browser sofort `clientOnline`, bei verbundenem Client die Geräteliste und den Status aller aktiven Relay-Streams senden.

#### Scenario: Browser lädt neu
- **WHEN** ein Browser die Verbindung öffnet und ein Client verbunden ist
- **THEN** erhält er `clientOnline=true`, `devices` und die Status der aktiven Streams

### Requirement: Kein Blockieren durch langsame Browser
Der Server SHALL Nachrichten mit einem Puffer von 64 pro Browser zustellen und bei vollem Puffer verwerfen, statt den Absender zu blockieren.

#### Scenario: Langsamer Browser
- **WHEN** der Sendepuffer eines Browsers voll ist
- **THEN** werden weitere Nachrichten für ihn verworfen und andere Browser bleiben unbeeinträchtigt

### Requirement: Browser-Herzschlag
Der Server SHALL jeden Browser alle 30 Sekunden anpingen und Verbindungen ohne Pong innerhalb von 60 Sekunden schließen; Browser-Nachrichten SHALL auf 512 Byte begrenzt sein.

#### Scenario: Browser antwortet nicht
- **WHEN** 60 Sekunden lang kein Pong eintrifft
- **THEN** wird die Verbindung geschlossen
