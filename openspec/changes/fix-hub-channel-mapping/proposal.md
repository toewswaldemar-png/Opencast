# Proposal

## Why

Durch Ausführung des echten Hub-Codes nachgewiesen: (1) Nach `Unsubscribe` eines Subscribers mit niedrigeren Kanälen zeigen die Positionen der übrigen Subscriber auf die falschen Kanäle (Test F-23: Stream auf Kanal 3/4 hört Kanal 1, −30,3 statt −20,8 dBFS). (2) Ein Mono-Stream (links gleich rechts) liefert doppelt so viele Frames wie das Gerät (F-01, Faktor 2,0). (3) Ein Monitor auf anderen Kanälen startet den Capturer neu, während ein Stream läuft (F-24). (4) Die Kanalzahl wird im Hub geraten statt mit dem Puffer geliefert (F-29).

## What Changes

- Positionen werden stets gegen die tatsächlich geöffnete Kanalfolge (`capChs`) berechnet.
- Der Fan-Out-Pfad liefert immer die rohen Treiberkanäle; die Stereo-Expansion erfolgt genau einmal im Hub.
- Callbacks tragen die Kanalzahl; falsche Längen werden verworfen.
- Ein laufender Stream wird durch neue Monitore nicht unterbrochen.
- Kanalangaben außerhalb des Gerätebereichs werden abgelehnt.

## Capabilities

### New Capabilities


### Modified Capabilities
- `audio-capture-hub`: Kanalvereinigung, stabile Zuordnung, Mono-Dauer, Kanalzahl im Puffer.
- `asio-capture`: Kanalvalidierung statt stillem Umbiegen.

## Impact

`client/internal/hub/hub.go`, `client/internal/audio/{types.go,asio_bridge.go,capturer_asio.go,level.go}`. Reproduktion: `specs/004-opencast-asio-deep-review/repro/run.sh`.
