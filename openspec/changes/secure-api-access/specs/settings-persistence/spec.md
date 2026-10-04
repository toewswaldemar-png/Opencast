# Spec Delta

## ADDED Requirements

### Requirement: Dateirechte der Konfiguration
Der Server SHALL `server.json` mit den Rechten `0600` schreiben und bestehende Dateien mit weiteren Rechten beim Start korrigieren.

#### Scenario: Neue Datei
- **WHEN** Einstellungen erstmals gespeichert werden
- **THEN** hat die Datei die Rechte `0600`

## MODIFIED Requirements

### Requirement: Einstellungen lesen
`GET /api/config` SHALL die gespeicherten Server-Einträge, Geräte-ID, Encoder-Profil und AutoReconnect liefern, jedoch ohne Passwörter; stattdessen SHALL je Eintrag `passwordSet` angeben, ob eines gespeichert ist.

#### Scenario: Gespeicherte Werte
- **WHEN** Einstellungen gespeichert wurden
- **THEN** liefert die Abfrage diese Werte ohne das Feld `password`

#### Scenario: Passwort bleibt bei Teil-Update
- **WHEN** `PUT /api/config` einen Server-Eintrag ohne Passwortfeld sendet
- **THEN** bleibt das gespeicherte Passwort erhalten
