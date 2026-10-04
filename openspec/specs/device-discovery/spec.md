# device-discovery Specification

## Purpose
Beschreibt, wie der Client verfügbare Audiogeräte meldet und der Server sie den Browsern bereitstellt.

## Requirements

### Requirement: Geräteliste bei Verbindung
Der Client SHALL nach jedem Verbindungsaufbau die Liste der Eingabegeräte an den Server senden.

#### Scenario: Erstverbindung
- **WHEN** der Client sich verbindet
- **THEN** sendet er eine `devices`-Nachricht

### Requirement: Geräteeigenschaften
Jedes Gerät SHALL ID, Name, API (`WASAPI`, `ASIO`), Zustand, maximale Eingangskanäle, Standard-Samplerate und ein Loopback-Kennzeichen enthalten; ASIO-Geräte tragen die ID `asio:<CLSID>` und den Namenszusatz " (ASIO)".

#### Scenario: ASIO-Gerät
- **WHEN** ein ASIO-Treiber gefunden wird
- **THEN** lautet die ID `asio:{CLSID}` und der Name endet auf " (ASIO)"

### Requirement: Geräteliste per API
Der Server SHALL `GET /api/devices` mit der zuletzt vom Client gemeldeten Liste beantworten, andernfalls mit einer leeren Liste.

#### Scenario: Kein Client
- **WHEN** noch keine Liste gemeldet wurde
- **THEN** antwortet der Server mit `[]`

### Requirement: Aktualisierung nach Panel
Nach dem Schließen eines ASIO-Control-Panels SHALL der Client die Geräteliste erneut senden.

#### Scenario: Kanalzahl geändert
- **WHEN** der Nutzer im Panel die Kanalzahl ändert
- **THEN** zeigen die Browser nach dem Schließen die neue Kanalzahl
