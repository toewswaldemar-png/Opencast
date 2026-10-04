# settings-persistence Specification

## Purpose
Beschreibt die Persistenz von Server- und Client-Einstellungen.

## Requirements

### Requirement: Konfigurationsdatei des Servers
Der Server SHALL seine Einstellungen als JSON unter `<Benutzerkonfigurationsverzeichnis>/Opencast/server.json` speichern und beim Start laden.

#### Scenario: Docker
- **WHEN** `XDG_CONFIG_HOME=/config` gesetzt ist
- **THEN** liegt die Datei unter `/config/Opencast/server.json`

### Requirement: Einstellungen lesen
`GET /api/config` SHALL die gespeicherten Server-Einträge, Geräte-ID, Encoder-Profil und AutoReconnect liefern.

#### Scenario: Gespeicherte Werte
- **WHEN** Einstellungen gespeichert wurden
- **THEN** liefert die Abfrage diese Werte

### Requirement: Einstellungen teilweise schreiben
`PUT /api/config` SHALL nur die mitgesendeten, nicht leeren Felder übernehmen und die übrigen unverändert lassen.

#### Scenario: Nur AutoReconnect
- **WHEN** nur `autoReconnect` gesendet wird
- **THEN** bleiben Server-Einträge und Encoder unverändert

### Requirement: AutoReconnect Standard
AutoReconnect SHALL ohne gespeicherten Wert als ausgeschaltet gelten.

#### Scenario: Neue Installation
- **WHEN** kein Wert gespeichert ist
- **THEN** wird ein Stream bei Icecast-Fehlern beendet statt neu verbunden

### Requirement: Client-Einstellungen
Der Client SHALL Server-URL (Standard `http://localhost:8765`) und letzte Geräte-ID in `client.json` im Benutzerkonfigurationsverzeichnis unter `Opencast` speichern.

#### Scenario: Erster Start
- **WHEN** keine Datei existiert
- **THEN** verwendet der Client `http://localhost:8765`
