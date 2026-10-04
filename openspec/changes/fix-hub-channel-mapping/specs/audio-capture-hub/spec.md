# Spec Delta

## ADDED Requirements

### Requirement: Stabile Kanalzuordnung
Die Zuordnung eines Subscribers zu den Kanälen des Capturers SHALL sich nur an der tatsächlich geöffneten Kanalfolge orientieren und beim Hinzufügen oder Entfernen anderer Subscriber unverändert richtige Kanäle liefern.

#### Scenario: Subscriber mit niedrigeren Kanälen geht
- **WHEN** Monitor A (Kanal 1/2) und Stream B (Kanal 3/4) laufen und A beendet wird
- **THEN** liefert B weiterhin Kanal 3/4

#### Scenario: Beliebige Reihenfolge
- **WHEN** bei drei Subscribern auf verschiedenen Kanalpaaren einer nach dem anderen entfernt wird
- **THEN** behalten alle übrigen ihre Kanäle

### Requirement: Dauer bleibt erhalten
Die Zahl der Audio-Frames, die einen Stream-Puffer erreichen, SHALL der Zahl der vom Treiber gelieferten Frames entsprechen, unabhängig davon, ob ein oder mehrere Kanäle geöffnet sind.

#### Scenario: Dual-Mono
- **WHEN** links und rechts denselben Kanal wählen und der Treiber 12 Puffer zu je 256 Frames liefert
- **THEN** enthält der Stream-Puffer 12 Frames zu 256 Stereo-Samples

### Requirement: Kanalzahl reist mit dem Puffer
Der Capturer SHALL die Kanalzahl jedes gelieferten Puffers an den Hub übergeben; der Hub SHALL Puffer mit abweichender Länge verwerfen.

#### Scenario: Falsche Länge
- **WHEN** ein Puffer kürzer ist als `frames × Kanäle × 2` Byte
- **THEN** wird er verworfen, ohne den Prozess zu beenden

## MODIFIED Requirements

### Requirement: ASIO-Kanalvereinigung
Bei ASIO-Geräten SHALL der Hub die Vereinigung aller von Subscribern benötigten Kanäle (0-basiert, aufsteigend sortiert) öffnen; eine Erweiterung der Vereinigung SHALL einen laufenden Stream nicht unterbrechen.

#### Scenario: Zwei Subscriber
- **WHEN** Subscriber auf den Kanälen 1/2 und 3/4 aktiv sind
- **THEN** öffnet der Capturer die Kanäle [0,1,2,3]

#### Scenario: Mono-Subscriber
- **WHEN** ein Subscriber links und rechts denselben Kanal wählt
- **THEN** besteht die Vereinigung aus einem Kanal

#### Scenario: Monitor während Stream
- **WHEN** bei laufendem Stream ein Monitor auf bisher ungeöffneten Kanälen startet
- **THEN** wird der Capturer nicht neu gestartet und der Stream bleibt ohne Lücke
