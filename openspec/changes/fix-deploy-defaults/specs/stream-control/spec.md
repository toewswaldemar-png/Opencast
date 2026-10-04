# Spec Delta

## MODIFIED Requirements

### Requirement: Ingest-URL
Ist `BASE_URL` gesetzt, SHALL der Server die Ingest-URL aus ihr und der `streamId` bilden und dem Client mitgeben; ist sie nicht gesetzt, SHALL der Server keine Ingest-URL senden und der Client SHALL sie aus seiner eigenen Server-URL bilden.

#### Scenario: Basis-URL gesetzt
- **WHEN** `BASE_URL=http://192.168.1.5:8765` gesetzt ist und `streamId=1`
- **THEN** lautet die Ingest-URL `http://192.168.1.5:8765/ingest/1`

#### Scenario: Basis-URL nicht gesetzt
- **WHEN** `BASE_URL` fehlt und der Client mit `http://192.168.1.5:8765` verbunden ist
- **THEN** sendet der Server keine Ingest-URL und der Client PUTtet an `http://192.168.1.5:8765/ingest/1`
