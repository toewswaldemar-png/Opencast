# Spec Delta

## Purpose
Beschreibt, wie der Server alle Schnittstellen (REST, Browser-WebSocket, Client-WebSocket, Ingest) vor unberechtigtem Zugriff schützt.

## ADDED Requirements

### Requirement: Authentifizierung aller Schnittstellen
Der Server SHALL für `/api/*`, `/ws`, `/ws/client` und `/ingest/*` ein gültiges Token verlangen und andernfalls mit HTTP 401 antworten bzw. den WebSocket-Upgrade ablehnen.

#### Scenario: Anfrage ohne Token
- **WHEN** `GET /api/config` ohne `Authorization` und ohne `token` eintrifft
- **THEN** antwortet der Server mit HTTP 401 und liefert keine Daten

#### Scenario: Anfrage mit gültigem Token
- **WHEN** `Authorization: Bearer <token>` mitgesendet wird
- **THEN** wird die Anfrage normal bearbeitet

### Requirement: Token-Verwaltung
Der Server SHALL beim ersten Start einen zufälligen Token erzeugen, persistent speichern und im Log ausgeben; Vergleiche SHALL in konstanter Zeit erfolgen.

#### Scenario: Erster Start
- **WHEN** weder Umgebungsvariable noch gespeicherter Token existiert
- **THEN** erzeugt der Server einen Token und gibt ihn einmalig im Log aus

### Requirement: Herkunftsprüfung
Der Server SHALL browserübergreifende Zugriffe (CORS) und WebSocket-Upgrades nur für konfigurierte Origins erlauben; ohne Konfiguration nur für die eigene Herkunft.

#### Scenario: Fremde Webseite
- **WHEN** eine fremde Origin per Browser `POST /api/stream/stop` aufruft
- **THEN** wird der Aufruf nicht freigegeben

### Requirement: Einmaliges Ingest-Geheimnis
Die vom Server erzeugte Ingest-URL SHALL ein einmaliges Geheimnis enthalten, das beim PUT geprüft und mit dem Verbrauch der Registrierung ungültig wird.

#### Scenario: Erratene streamId
- **WHEN** ein PUT mit gültiger `streamId` aber ohne Geheimnis eintrifft
- **THEN** antwortet der Server mit HTTP 401 und die Registrierung bleibt bestehen
