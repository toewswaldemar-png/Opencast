# Spec Delta

## ADDED Requirements

### Requirement: Asynchrone Aufzählung
Der Client SHALL die Geräteliste in einer eigenen Goroutine erzeugen und senden, ohne Befehle des Servers zu verzögern.

#### Scenario: Befehl während Aufzählung
- **WHEN** `cmd:start` eintrifft, während Geräte aufgezählt werden
- **THEN** wird der Befehl ohne Wartezeit bearbeitet
