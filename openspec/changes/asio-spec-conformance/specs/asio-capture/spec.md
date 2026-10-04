# Spec Delta

## ADDED Requirements

### Requirement: Treiber-Neustartanforderungen
Auf `kAsioResetRequest`, `kAsioBufferSizeChange`, `kAsioResyncRequest` und `sampleRateDidChange` SHALL der Client im Callback sofort mit der von der Spezifikation vorgesehenen Antwort zurückkehren und den Capturer nach 500 ms Entprellzeit außerhalb des Treiber-Callbacks neu starten, jedoch nicht während das Control-Panel geöffnet ist.

#### Scenario: Reset durch Panel-Änderung
- **WHEN** der Treiber `kAsioResetRequest` sendet
- **THEN** antwortet der Client mit 1, stoppt nach 500 ms und startet den Capturer neu, ohne den Treiber im Callback zu entladen

#### Scenario: Reset bei offenem Panel
- **WHEN** der Treiber während des offenen Panels einen Reset anfordert
- **THEN** erfolgt der Neustart erst nach dem Schließen des Panels

### Requirement: Überlastmeldungen
Der Client SHALL `kAsioCanReportOverload` abfragen, `kAsioOverload` zählen und mindestens einmal pro Sekunde (bei Auftreten) loggen sowie dem Nutzer anzeigen.

#### Scenario: Treiber meldet Aussetzer
- **WHEN** `kAsioOverload` eintrifft
- **THEN** erhöht sich der Zähler und das Log enthält eine Überlastmeldung

### Requirement: Samplerate-Rückgabecodes
Der Client SHALL die Rückgabecodes von `canSampleRate`, `setSampleRate` und `getSampleRate` auswerten; eine unbekannte Rate (0 oder `ASE_NoClock`) SHALL den Start mit einer Fehlermeldung abbrechen und die tatsächliche Rate SHALL dem Encoder gemeldet werden.

#### Scenario: Externe Clock ohne Signal
- **WHEN** `getSampleRate` 0 und `ASE_NoClock` liefert
- **THEN** meldet der Client "Keine Samplerate-Referenz" und startet keinen Stream

### Requirement: Nachlaufende Callbacks
Nach `ASIOStop` SHALL der Client bis zu 2 Sekunden warten, bis kein Callback mehr läuft, bevor Puffer freigegeben werden; läuft nach Ablauf noch ein Callback, SHALL der Puffer nicht freigegeben werden.

#### Scenario: Treiber ruft nach Stop weiter
- **WHEN** ein Callback nach `stop()` noch aktiv ist
- **THEN** wird `g_pcmBuf` nicht freigegeben und der Vorfall geloggt

### Requirement: Balancierte COM-Initialisierung
Der Client SHALL `RPC_E_CHANGED_MODE` tolerieren und `CoUninitialize` nur aufrufen, wenn `CoInitializeEx` auf demselben Thread erfolgreich war.

#### Scenario: Thread bereits im anderen Apartment
- **WHEN** `CoInitializeEx` `RPC_E_CHANGED_MODE` liefert
- **THEN** wird der Treiber trotzdem geladen und `CoUninitialize` nicht aufgerufen

### Requirement: Tray-Panel
Der Tray-Eintrag "ASIO Panel" SHALL das Gerät wählbar anbieten und denselben Ablauf wie `cmd:asio:panel` verwenden.

#### Scenario: Zwei ASIO-Geräte
- **WHEN** zwei ASIO-Geräte vorhanden sind
- **THEN** kann der Nutzer das Gerät wählen und ein laufender Capture dieses Geräts wird für die Dauer des Panels gestoppt

## MODIFIED Requirements

### Requirement: Ein Treiber zur Zeit
Der Client SHALL höchstens einen ASIO-Treiber gleichzeitig geöffnet halten; der Versuch, ein anderes ASIO-Gerät zu öffnen, SHALL sofort mit der Meldung "ASIO-Treiber belegt durch <Gerät>" scheitern, statt unbegrenzt zu warten.

#### Scenario: Zweites Gerät
- **WHEN** Gerät A aufnimmt und Gerät B gestartet wird
- **THEN** erhält der Nutzer sofort die Fehlermeldung "ASIO-Treiber belegt" und die UI hängt nicht

#### Scenario: Gerätewechsel
- **WHEN** der Monitor auf einen anderen ASIO-Treiber wechselt
- **THEN** wird der alte Treiber freigegeben, bevor der neue geöffnet wird

### Requirement: Kanalzahl-Probe mit Cache
Der Client SHALL die Eingangskanalzahl jedes ASIO-Treibers durch kurzes Öffnen ermitteln, jedoch nicht während einer laufenden Aufnahme; dann gilt der gecachte Wert, ohne Cache "unbekannt" (0). Die Probe SHALL ein Zeitlimit haben und Treiber einer Blacklist überspringen.

#### Scenario: Treiber belegt
- **WHEN** ein Treiber gerade aufnimmt und die Geräteliste aktualisiert wird
- **THEN** wird der gecachte Kanalwert gemeldet

#### Scenario: Kein Cache
- **WHEN** weder Probe noch Cache einen Wert liefern
- **THEN** wird die Kanalzahl als unbekannt gemeldet und nie ein erfundener Wert

#### Scenario: Hängender Treiber
- **WHEN** ein Treiber auf die Probe nicht antwortet
- **THEN** wird er nach dem Zeitlimit als "nicht antwortend" markiert und die übrige Liste erscheint

### Requirement: Wächter für ausbleibende Callbacks
Bleibt während der gesamten Laufzeit, nicht nur nach dem Start, 5 Sekunden lang jeder Callback aus, SHALL der Capturer beendet und mit Fehlermeldung neu gestartet werden; bei wiederholtem Ausbleiben SHALL der Abstand der Neustarts wachsen und nach einer Obergrenze ein dauerhafter Fehler gemeldet werden.

#### Scenario: ReaRoute ohne REAPER
- **WHEN** kein Host Audio liefert
- **THEN** wird der Capturer gestoppt und die Neustart-Abstände wachsen (3 s, 6 s, 12 s … bis 60 s)

#### Scenario: Gerät mitten im Betrieb entfernt
- **WHEN** nach laufendem Betrieb 5 Sekunden keine Callbacks eintreffen
- **THEN** wird der Capturer neu gestartet

### Requirement: Sample-Konvertierung
Der Client SHALL alle PCM- und Float-Sampletypen der ASIO-Spezifikation korrekt in 16-Bit-PCM wandeln (Int16/24/32 LSB und MSB, Int32 mit 16/18/20/24 Bit rechtsbündig LSB und MSB, Float32/64 LSB und MSB) und je aktivem Kanal anwenden; nicht unterstützte Typen (z. B. DSD) SHALL den Start mit Typnummer ablehnen.

#### Scenario: 24 Bit rechtsbündig
- **WHEN** der Treiber `ASIOSTInt32LSB24` mit Vollausschlag `0x007FFFFF` liefert
- **THEN** ergibt die Wandlung 32767

#### Scenario: DSD
- **WHEN** der Treiber `ASIOSTDSDInt8LSB1` meldet
- **THEN** schlägt der Start mit einer Meldung inklusive Typnummer fehl

#### Scenario: Float-Eingang
- **WHEN** der Treiber `ASIOSTFloat32LSB` liefert
- **THEN** werden die Werte auf [-1,1] begrenzt und nach 16 Bit skaliert
