# Spec Delta

## ADDED Requirements

### Requirement: Kanalvalidierung
Der Client SHALL Kanalangaben außerhalb von 1 bis zur gemeldeten Eingangskanalzahl des Treibers ablehnen und dem Nutzer melden, statt sie stillschweigend auf einen anderen Kanal abzubilden.

#### Scenario: Kanal außerhalb des Bereichs
- **WHEN** links 9 gewählt wird und der Treiber 8 Eingänge hat
- **THEN** schlägt der Start mit einer Fehlermeldung fehl und kein Kanal wird umgebogen
