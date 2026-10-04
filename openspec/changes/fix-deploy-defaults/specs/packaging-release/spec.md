# Spec Delta

## ADDED Requirements

### Requirement: Schlankes, unprivilegiertes Image
Das Container-Image SHALL nur die vom Server benötigten Pakete enthalten (kein ffmpeg) und den Server als unprivilegierten Benutzer mit Healthcheck starten.

#### Scenario: Image prüfen
- **WHEN** das Image gestartet wird
- **THEN** läuft der Prozess nicht als root und `ffmpeg` ist nicht installiert

### Requirement: Konsistente Dokumentation
README und Konfigurationsbeispiele SHALL das tatsächliche Verhalten beschreiben, insbesondere Architektur, Bedeutung von `BASE_URL`, Speicherort der Konfiguration und Zugangstoken.

#### Scenario: BASE_URL
- **WHEN** ein Nutzer das README zu `BASE_URL` liest
- **THEN** erfährt er, dass sie die vom Client genutzte Ingest-Adresse bestimmt
