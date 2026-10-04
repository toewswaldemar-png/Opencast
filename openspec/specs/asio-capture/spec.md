# asio-capture Specification

## Purpose
Beschreibt die ASIO-Aufnahme des Windows-Clients: Treiberzugriff, Kanalkonfiguration, Samplerate, Wiederanlauf und Control-Panel.

## Requirements

### Requirement: Kanalkonfiguration
Kanäle SHALL in UI und API 1-basiert (`channelLeft`, `channelRight`) und intern 0-basiert geführt werden; bei links gleich rechts SHALL ein einziger ASIO-Kanal geöffnet werden.

#### Scenario: Stereo
- **WHEN** links 1 und rechts 2 gewählt sind
- **THEN** werden die Treiberkanäle 0 und 1 geöffnet

#### Scenario: Dual-Mono
- **WHEN** links und rechts denselben Kanal wählen
- **THEN** wird genau ein Treiberkanal geöffnet

### Requirement: Ein Treiber zur Zeit
Der Client SHALL das Öffnen von ASIO-Treibern über einen globalen Mutex serialisieren; ein neuer Öffnungsvorgang SHALL warten, bis der vorherige Treiber freigegeben ist.

#### Scenario: Gerätewechsel
- **WHEN** das Monitor-Gerät auf einen anderen ASIO-Treiber wechselt
- **THEN** wird der alte Treiber freigegeben, bevor der neue geöffnet wird

### Requirement: Nur Eingänge
Der Client SHALL beim Aufnehmen ausschließlich Eingangskanäle registrieren und `kAsioSupportsTimeInfo` mit 1 beantworten.

#### Scenario: ReaRoute
- **WHEN** ein Treiber den Zeitinfo-Modus anfragt
- **THEN** antwortet der Client mit 1 und erhält `bufferSwitchTimeInfo`-Callbacks

### Requirement: Samplerate nur bei Bedarf setzen
Der Client SHALL die Samplerate des Treibers nur dann setzen, wenn sie von der gewünschten abweicht; unterstützt der Treiber die gewünschte Rate nicht, SHALL die aktuelle Rate bestätigt und verwendet werden.

#### Scenario: Gleiche Rate
- **WHEN** der Treiber bereits mit der gewünschten Rate läuft
- **THEN** wird `setSampleRate` nicht aufgerufen

### Requirement: Winsock-Referenz
Der Client SHALL vor dem Laden eines ASIO-Treibers (Öffnen und Probe) `WSAStartup` aufrufen, damit Treiber-`WSACleanup` den Winsock-Zähler nicht auf 0 senken kann.

#### Scenario: Viele Proben
- **WHEN** nacheinander viele Treiber geprobt werden
- **THEN** funktionieren Netzwerkaufrufe des Clients weiter

### Requirement: Kanalzahl-Probe mit Cache
Der Client SHALL die Eingangskanalzahl jedes ASIO-Treibers durch kurzes Öffnen ermitteln; ist der Treiber belegt, SHALL der zuletzt bekannte Wert aus dem Cache verwendet werden.

#### Scenario: Treiber belegt
- **WHEN** ein Treiber gerade aufnimmt und die Geräteliste aktualisiert wird
- **THEN** wird der gecachte Kanalwert gemeldet

### Requirement: Wächter für ausbleibende Callbacks
Trifft nach dem Start 5 Sekunden lang kein Callback ein, SHALL der Capturer beendet werden, damit der Hub ihn neu startet.

#### Scenario: ReaRoute ohne REAPER
- **WHEN** kein Host Audio liefert
- **THEN** wird der Capturer nach 5 s gestoppt

### Requirement: Control-Panel
Auf `cmd:asio:panel` SHALL der Client den Capturer des Geräts stoppen, das Treiber-Panel öffnen und bis zum Schließen warten, danach die Geräteliste neu senden und den Capturer wieder öffnen.

#### Scenario: Panel wird geschlossen
- **WHEN** der Nutzer das Panel schließt
- **THEN** sendet der Client die aktualisierte Geräteliste und öffnet den Capturer wieder

### Requirement: Sample-Konvertierung
Der Client SHALL die Sampletypen Int16 (LSB/MSB), Int24 (LSB), Int32 (LSB/MSB) sowie Float32 und Float64 (LSB) in 16-Bit-PCM wandeln.

#### Scenario: Float-Eingang
- **WHEN** der Treiber `ASIOSTFloat32LSB` liefert
- **THEN** werden die Werte auf [-1,1] begrenzt und nach 16 Bit skaliert
