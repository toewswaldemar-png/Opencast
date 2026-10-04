# web-ui Specification

## Purpose
Beschreibt das Verhalten der Web-Oberfläche (React/Vite), die vom Server ausgeliefert wird.

## Requirements

### Requirement: Kanalauswahl
Die UI SHALL für Eingangskanäle getrennte Dropdowns "Links" und "Rechts" mit 1-basierten Werten von 1 bis mindestens 2 und höchstens der gemeldeten Kanalzahl anbieten.

#### Scenario: Gerät mit 8 Kanälen
- **WHEN** ein Gerät 8 Eingangskanäle meldet
- **THEN** bieten beide Dropdowns die Werte 1 bis 8

### Requirement: Echtzeitverbindung
Die UI SHALL die WebSocket-Verbindung `/ws` nach einem Abbruch nach 2 Sekunden neu aufbauen und den Verbindungszustand anzeigen.

#### Scenario: Server-Neustart
- **WHEN** die Verbindung abbricht
- **THEN** versucht die UI nach 2 s erneut zu verbinden

### Requirement: Monitore nur mit Client
Die UI SHALL Pegel-Monitore nur starten, wenn ein Windows-Client als verbunden gemeldet ist, und beim Verlust des Clients die Monitore als beendet behandeln.

#### Scenario: Client offline
- **WHEN** `clientOnline=false` eintrifft
- **THEN** startet die UI keine Monitore

### Requirement: Pegel-Abfallzeit
Die UI SHALL die Abfallzeit der VU-Anzeige in `localStorage` unter `vuDecayMs` speichern und beim Laden wiederherstellen.

#### Scenario: Neu laden
- **WHEN** der Nutzer die Seite neu lädt
- **THEN** gilt die zuvor gewählte Abfallzeit

### Requirement: Auslieferung durch den Server
Der Server SHALL die gebaute Oberfläche aus dem eingebetteten Verzeichnis `dist` ausliefern und unbekannte Pfade auf `index.html` abbilden.

#### Scenario: Direktaufruf einer Route
- **WHEN** ein Browser einen Pfad ohne Datei aufruft
- **THEN** erhält er `index.html`
