# Spec Delta

## ADDED Requirements

### Requirement: Zugangscode
Die UI SHALL beim ersten Aufruf einen Zugangscode abfragen, ihn nur für die Browser-Sitzung speichern und bei allen API-Aufrufen als `Authorization: Bearer` sowie am WebSocket als `token` mitsenden.

#### Scenario: Falscher Code
- **WHEN** der Server mit HTTP 401 antwortet
- **THEN** zeigt die UI "Ungültiger Token" und lässt keine Bedienung zu
