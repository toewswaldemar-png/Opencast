# Spec Delta

## ADDED Requirements

### Requirement: Authentifizierter Windows-Client
Der Server SHALL `/ws/client` nur mit gültigem Token annehmen; eine nicht authentifizierte Verbindung SHALL die bestehende Client-Verbindung nicht verdrängen.

#### Scenario: Fremder Verbindungsversuch
- **WHEN** ein Teilnehmer ohne Token `/ws/client` aufruft
- **THEN** wird der Upgrade abgelehnt und der verbundene Client bleibt verbunden
