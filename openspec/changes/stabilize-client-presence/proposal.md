# Proposal

## Why

Test W-1: Wird ein neuer `/ws/client` aufgebaut, bevor der alte erkannt wurde getrennt (Netzwechsel, Ruhezustand), sendet der alte Handler nach dem Ersetzen `clientOnline=false`. In 38 bis 40 von 40 Wiederholungen sah der Browser danach "Client offline", obwohl ein Client verbunden war; die UI beendet dann alle Monitore. Außerdem bleiben Geräteliste und Stream-Status nach einer Trennung im Server stehen, und der Client erzeugt beim Verbindungsaufbau die Geräteliste synchron (alle ASIO-Treiber proben) vor dem Heartbeat; dauert das über 90 s, trennt der Server und es entsteht eine Wiederverbindungsschleife.

## What Changes

- Das Ersetzen einer Verbindung erzeugt höchstens ein `clientOnline=true` und kein späteres `false` vom alten Handler.
- Nach einer Trennung sind Geräteliste und Stream-Status als veraltet gekennzeichnet bzw. geleert.
- Der Client startet Heartbeat und Read-Loop vor der Geräteaufzählung; die Aufzählung läuft asynchron.

## Capabilities

### New Capabilities


### Modified Capabilities
- `client-connection`: konsistenter Online-Zustand, Zustand nach Trennung, Verbindungsaufbau ohne Blockade.
- `device-discovery`: asynchrone Aufzählung.

## Impact

`server/internal/api/websocket_client.go`, `server/internal/api/server.go` (`HandleStatus`), `client/internal/wsclient/client.go`. Reproduktion: Test `TestW1`.
