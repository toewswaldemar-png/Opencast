# Opencast Constitution

Abgeleitet aus `CLAUDE.md` und den Prüfungen in `specs/001`–`005`; gilt für das ganze Projekt (Server, Client, Frontend).
Diese Prinzipien sind die Prüfgrundlage für `/speckit-analyze`.

## Core Principles

### I. Audio-Thread ist heilig (NON-NEGOTIABLE)
Der C→Go-Callback `goAsioBufferCallback` läuft auf dem ASIO-Treiberthread.
Im Monitor-Modus MUSS er ohne Heap-Allokation und ohne blockierende Locks auskommen
(Fast-Path: Buffer voll und kein Level fällig → sofortiger Return).
Im Streaming-Modus sind Allokationen erlaubt, blockierende Locks SOLLEN vermieden werden.
Geteilter Zustand zum Callback läuft über Atomics (`globalASIOCapturer`).

### II. Ein ASIO-Treiber zur Zeit, deterministischer Lebenszyklus
`asioGlobalMu` serialisiert Treiber-Opens. Open, Start, Stop, Release folgen einer
festen Reihenfolge und sind pro Capturer-Instanz gebunden. Ein neuer Open darf niemals
auf den Release eines alten Capturers warten, der erst durch den neuen Open freigegeben wird
(Monitor-Deadlock, siehe CLAUDE.md). Jeder COM-Init ist mit genau einem CoUninitialize balanciert.

### III. Kanalsemantik ist eindeutig
Kanäle sind in der UI 1-basiert, intern 0-basiert (`channelLeft`/`channelRight`, `uint16`).
L == R öffnet genau 1 ASIO-Kanal. Ungültige Kanäle werden als Fehler gemeldet,
nicht still umgebogen. Die Frame-Zahl am Ausgang eines Capturers entspricht der Frame-Zahl am Eingang.

### IV. Sample-Formate werden vollständig behandelt oder abgelehnt
Jeder vom Treiber gemeldete `ASIOSampleType` wird korrekt nach int16 gewandelt
oder beim Start mit klarer Fehlermeldung abgelehnt. Kein stilles Fallback auf Rauschen.

### V. Treiber-Eigenheiten sind dokumentierte, getestete Entscheidungen
WSAStartup-Refcount-Bump, Include-Reihenfolge `winsock2.h` vor `windows.h`,
`kAsioSupportsTimeInfo = 1`, keine Output-Kanäle für ReaRoute: jede Eigenheit hat einen
Kommentar mit Grund UND einen Eintrag in CLAUDE.md. Code und CLAUDE.md dürfen nicht auseinanderlaufen.

### VI. Ausfälle sind sichtbar und wiederherstellbar
Treiber-Reset, Samplerate-Wechsel, ausbleibende Callbacks und Treiber-Absturz führen zu einem
erkennbaren Zustand (Fehlermeldung an die UI) und zu einem kontrollierten Neustart —
nicht zu stillem Stillstand oder unbegrenztem Restart-Sturm.

### VII. Testbarkeit der Grenze C ↔ Go ↔ Hub
Logik an der Grenze (Mono-Expansion, Kanal-Mapping, Sample-Konvertierung, Channel-Union)
liegt in reinen, ohne Treiber testbaren Funktionen. CI baut nicht nur, sondern vettet und testet.

### VIII. Die offizielle ASIO-Spezifikation ist normativ
Referenz: *Steinberg ASIO SDK 2.3, Interface Specification, Documentation Release #4* (und `asio.h`/`iasiodrv.h`).
Bei Widerspruch zwischen Code, CLAUDE.md und Spezifikation gilt die Spezifikation. Abweichungen sind nur als
dokumentierte Treiber-Workarounds zulässig (Kommentar mit betroffenem Treiber und Spec-Stelle, Eintrag in CLAUDE.md).
Die Referenz-Hosts (SDK-`hostsample`, PortAudio, JUCE) dienen als Praxisbeleg, nicht als Norm.

### IX. Lizenz der ASIO-Nutzung ist geklärt
Der Build gegen das ASIO SDK und die Weitergabe von `opencast-client-asio.exe` erfolgen auf Basis einer bewusst gewählten
Lizenz (Steinberg ASIO License ODER GPLv3, SDK seit 2.3.4 dual lizenziert). Das Repository enthält die dazu passende
Lizenzdatei und Markenhinweise. Das SDK selbst wird nicht ins Repository eingecheckt.

### X. Grenzen sind authentifiziert und validiert
Jede Schnittstelle, die von außen erreichbar ist (REST, WebSockets, Ingest), verlangt ein Token. Eingaben, die in Protokolle,
Pfade, Header oder COM-/Treiberaufrufe einfließen, werden validiert (keine Steuerzeichen, Geräte-IDs nur aus der bekannten Liste).
Geheimnisse (Icecast-Passwörter, Token) werden weder ausgeliefert noch mit weiten Dateirechten gespeichert.

### XI. Tests und CI schützen jede Änderung
Kernlogik (Hub, Session, Relay, Handler) ist ohne Windows testbar. Jeder Pull Request führt `go vet`, `go test -race`, die
Frontend-Typprüfung und die Kompilierung der Clients aus. Jede nachgewiesene Abweichung bekommt einen Test, der vor dem Fix rot ist.

### XII. Eine Quelle der Wahrheit für Verhalten
Beobachtbares Verhalten steht in `openspec/specs/` und wird nur über OpenSpec-Changes (`openspec/changes/`) geändert;
Aufgaben leben im jeweiligen Change. Spec-Kit-Dokumente unter `specs/` sind Review-Berichte und halten Befunde, Belege und
Reproduktionen fest, sie führen keine zweite Aufgabenliste.

## Zusätzliche Randbedingungen
- Plattform Windows; ASIO-Build nur mit `-tags asio` und MinGW + ASIO SDK.
- Der ASIO-Client heißt immer `opencast-client-asio.exe`.
- Es gibt genau eine produktive ASIO-Implementierung (`client/`). Parallelpfade (`backend/`) werden
  entweder synchron gehalten oder entfernt.

## Governance
Diese Constitution schlägt Einzelwünsche in Specs, Plänen und Tasks. Änderungen erfolgen explizit
und getrennt von Feature-Arbeit, mit Begründung in der Versionszeile.

**Version**: 1.2.0 | **Ratified**: 2026-10-03 | **Last Amended**: 2026-10-03
(1.1.0: Prinzipien VIII und IX ergänzt — offizielle Spec als Norm, Lizenzklärung.)
(1.2.0: Prinzipien X, XI, XII ergänzt — Grenzen absichern, Tests/CI, OpenSpec als Quelle der Wahrheit; Geltungsbereich jetzt das ganze Projekt.)
