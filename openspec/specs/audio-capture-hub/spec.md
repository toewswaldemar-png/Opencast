# audio-capture-hub Specification

## Purpose
Beschreibt, wie der Windows-Client pro Audiogerät einen gemeinsamen Capturer verwaltet, der Monitore (Pegel) und Streams (Pegel, Encoding, Ingest) bedient.

## Requirements

### Requirement: Ein Capturer pro Gerät
Der Client SHALL pro Geräte-ID genau einen Hub mit höchstens einem Capturer führen; alle Subscriber dieses Geräts teilen sich diesen Capturer.

#### Scenario: Zweiter Subscriber
- **WHEN** ein zweiter Subscriber dasselbe Gerät abonniert
- **THEN** wird kein weiterer Capturer gestartet, sofern die benötigten Kanäle bereits geöffnet sind

### Requirement: Lebenszyklus des Capturers
Der Capturer SHALL beim ersten Subscriber starten und stoppen, wenn der letzte Subscriber entfernt wurde.

#### Scenario: Letzter Subscriber geht
- **WHEN** der letzte Subscriber eines Geräts entfernt wird
- **THEN** wird der Capturer gestoppt

### Requirement: Monitor und Stream
Ein Subscriber SHALL entweder Monitor (nur Pegel) oder Stream (Pegel, Encoding, Ingest) sein; ein Monitor SHALL einen gleichnamigen Stream-Subscriber nicht verdrängen.

#### Scenario: Monitor-Stopp mit gleicher ID
- **WHEN** `monitor:stop` für eine ID eintrifft, unter der ein Stream läuft
- **THEN** bleibt der Stream unberührt

### Requirement: Monitore getrennt stoppen
`StopMonitors` SHALL alle reinen Monitore entfernen und laufende Streams unberührt lassen.

#### Scenario: Globaler Monitor-Stopp
- **WHEN** ein globaler Monitor-Stopp ausgeführt wird, während ein Stream läuft
- **THEN** läuft der Stream weiter

### Requirement: Selbstheilung
Stoppt ein Capturer unerwartet (Treiberabsturz, Gerät entfernt) und existieren noch Subscriber, SHALL der Hub nach 3 Sekunden einen Neustart versuchen und bei Fehlschlag allen Subscribern einen Fehler melden.

#### Scenario: Treiber stürzt ab
- **WHEN** der Capturer ohne Stopp-Befehl endet
- **THEN** startet der Hub ihn nach 3 s neu

### Requirement: Streams überleben Capturer-Neustarts
Eine laufende Stream-Session SHALL bei einem Capturer-Wechsel bestehen bleiben und in der Zwischenzeit Stille senden.

#### Scenario: Capturer wird ersetzt
- **WHEN** der Capturer neu gestartet wird
- **THEN** bleibt die Icecast-Verbindung der Stream-Session offen

### Requirement: ASIO-Kanalvereinigung
Bei ASIO-Geräten SHALL der Hub die Vereinigung aller von Subscribern benötigten Kanäle (0-basiert, aufsteigend sortiert) öffnen und bei einer Erweiterung der Vereinigung den Capturer neu starten.

#### Scenario: Zwei Subscriber
- **WHEN** Subscriber auf den Kanälen 1/2 und 3/4 aktiv sind
- **THEN** öffnet der Capturer die Kanäle [0,1,2,3]

#### Scenario: Mono-Subscriber
- **WHEN** ein Subscriber links und rechts denselben Kanal wählt
- **THEN** besteht die Vereinigung aus einem Kanal

### Requirement: PCM-Puffer
Jede Stream-Session SHALL aus einem Ringpuffer mit 50 Frames zu je 1024 Byte (256 Stereo-Samples) lesen, bei Überlauf das älteste Frame verwerfen und bei leerem Puffer Stille liefern.

#### Scenario: Leerer Puffer
- **WHEN** die Session ein Frame liest und der Puffer leer ist
- **THEN** erhält sie ein Frame aus Nullen

### Requirement: Takt der Stream-Session
Die Stream-Session SHALL die Frames im Takt einer Wanduhr (Frame-Dauer = 256 Samples / Samplerate) an den Encoder geben und die Icecast-Verbindung sofort beim Start öffnen.

#### Scenario: Session startet
- **WHEN** eine Stream-Session startet
- **THEN** wird der Encoder gestartet und der Ingest sofort geöffnet, auch wenn noch kein Audio vorliegt
