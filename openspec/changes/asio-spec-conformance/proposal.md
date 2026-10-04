# Proposal

## Why

Prüfung gegen die offizielle ASIO-Spezifikation 2.3 (Spec Kit 002) und die Referenz-Hosts PortAudio/Ardour (003): Unbehandelte Sampletypen (`Int32LSB16..24` rechtsbündig → −48 dB bis Stille, `Int24MSB`, `Float*MSB`, DSD) liefern falsche Pegel statt eines Fehlers; `kAsioResetRequest`, `sampleRateDidChange`, Überlast und Rückgabecodes der Samplerate-Aufrufe werden ignoriert; ein zweites ASIO-Gerät blockiert unbegrenzt; bei laufendem Capture werden fremde Geräte mit erfundenen 32 Kanälen gelistet; nach `ASIOStop` wird der PCM-Puffer sofort freigegeben (PortAudio dokumentiert nachlaufende Callbacks); COM-Init und -Uninit sind in `asio_open_driver` unbalanciert; das Control-Panel im Tray öffnet immer das erste Gerät und stoppt den Capture nicht.

## What Changes

- Alle `ASIOSampleType`-Werte der Spezifikation werden korrekt gewandelt oder beim Start mit Typnummer abgelehnt; Typ je Kanal.
- Reset-, Resync-, Puffergrößen- und Samplerate-Meldungen führen zu einem entprellten, kontrollierten Neustart außerhalb des Treiber-Callbacks.
- Überlastmeldungen werden gezählt und angezeigt.
- Rückgabecodes von `canSampleRate`/`setSampleRate`/`getSampleRate` werden ausgewertet; Rate 0 ist ein Fehler.
- Ein zweites ASIO-Gerät erhält sofort eine Fehlermeldung.
- Während einer Aufnahme werden keine Treiber geprobt; fehlende Werte sind "unbekannt".
- Nachlaufende Callbacks nach `ASIOStop` werden abgewartet, bevor Puffer freigegeben werden.
- COM-Initialisierung ist balanciert und toleriert `RPC_E_CHANGED_MODE`.
- Der Tray-Eintrag nutzt denselben Panel-Ablauf wie `cmd:asio:panel`.

## Capabilities

### New Capabilities


### Modified Capabilities
- `asio-capture`: Sample-Konvertierung, Neustartanforderungen, Überlast, Samplerate, Treiberbelegung, Probe, Stopp, COM, Panel.

## Impact

`client/internal/audio/{asio_host.cpp,asio_bridge.go,capturer_asio.go}`, `client/main_windows.go`. Details: `specs/002-asio-api-conformance`, `specs/003-ardour-asio-review`.
