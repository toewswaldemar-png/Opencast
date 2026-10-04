# Design

## Context

`ServeWS` ruft nach `readPump` unbedingt `Broadcast(MsgClientOnline, false)` auf, auch wenn `ch.conn != c` (ersetzt).

## Goals / Non-Goals

**Goals:**
- Der Browser sieht nach Reconnect immer `true`.
- Der Client reagiert innerhalb von Sekunden auf Befehle, auch bei vielen ASIO-Treibern.

**Non-Goals:**
- Mehrere Windows-Clients gleichzeitig.

## Decisions

1. Nach `readPump`: `Broadcast(false)` nur, wenn diese Verbindung noch die aktuelle war (`ch.conn == c` unter Sperre).
2. Bei echter Trennung `devices` und `status` leeren (oder mit `stale:true` markieren); `HandleStatus` liefert dann keine laufenden Streams.
3. Client: `go c.sendDevices()` nach Start von Heartbeat und Read-Loop; bei laufendem Capture nur Cache (siehe `asio-spec-conformance`).

## Risks / Trade-offs

- Browser, die gerade Geräte anzeigen, verlieren sie bei echter Trennung (gewollt).
