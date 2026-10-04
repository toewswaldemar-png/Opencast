# Spec Delta

## ADDED Requirements

### Requirement: Idempotenter Stopp
`Unregister` SHALL beliebig oft und gleichzeitig für denselben Stream aufrufbar sein, ohne Panik und ohne Datenwettlauf.

#### Scenario: Doppelter Stopp
- **WHEN** HTTP-Stopp und `stream:error` des Clients gleichzeitig eintreffen
- **THEN** wird der Stream genau einmal beendet und der Server läuft weiter
