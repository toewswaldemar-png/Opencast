# Spec Delta

## ADDED Requirements

### Requirement: Geräte-ID-Validierung
Der Client SHALL Befehle mit einer `deviceId`, die nicht in der zuletzt gemeldeten Geräteliste steht, ablehnen und dafür keine Treiber- oder COM-Objekte erzeugen.

#### Scenario: Unbekannte ID
- **WHEN** `cmd:asio:panel` mit `asio:{00000000-0000-0000-0000-000000000000}` eintrifft
- **THEN** meldet der Client einen Fehler und ruft `CoCreateInstance` nicht auf

#### Scenario: Bekannte ID
- **WHEN** die ID in der Geräteliste steht
- **THEN** wird der Befehl ausgeführt
