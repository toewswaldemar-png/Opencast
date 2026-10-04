# Spec Delta

## ADDED Requirements

### Requirement: Header-Werte ohne Steuerzeichen
Der Server SHALL Name, Beschreibung, Genre, URL, Content-Type, Host und Mountpunkt vor der Übernahme in einen Request auf Zeilenumbrüche und Steuerzeichen prüfen und Eingaben mit solchen Zeichen mit HTTP 400 ablehnen.

#### Scenario: Zeilenumbruch im Namen
- **WHEN** der Name `Radio\r\nX-Injected: yes` enthält
- **THEN** antwortet der Server mit HTTP 400 und sendet nichts an Icecast

### Requirement: TLS für die Source-Verbindung
Bei `useSSL=true` SHALL der Server die Source-Verbindung zu Icecast per TLS mit Zertifikatsprüfung aufbauen.

#### Scenario: TLS aktiv
- **WHEN** `useSSL=true` konfiguriert ist
- **THEN** wird die Verbindung per TLS aufgebaut und Zugangsdaten werden nicht im Klartext übertragen

### Requirement: Nebenläufigkeitssicherer Client
Der Icecast-Client SHALL gleichzeitige Aufrufe von `Connect`, `Write` und `Disconnect` ohne Datenwettlauf und ohne Absturz verarbeiten.

#### Scenario: Stopp während Schreiben
- **WHEN** `Disconnect` während eines `Write` aufgerufen wird
- **THEN** meldet der Race-Detektor keinen Fehler und es tritt keine Panik auf

### Requirement: Zielbeschränkung
Ist `ICECAST_ALLOWED_HOSTS` gesetzt, SHALL der Server nur Verbindungen zu den dort genannten Hosts aufbauen.

#### Scenario: Nicht erlaubter Host
- **WHEN** ein Stream auf einen Host außerhalb der Liste startet
- **THEN** antwortet der Server mit HTTP 400
