# Opencast Constitution

Abgeleitet aus `CLAUDE.md` (Stand der ASIO-Implementierung in `client/internal/audio/`).
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

## Zusätzliche Randbedingungen
- Plattform Windows; ASIO-Build nur mit `-tags asio` und MinGW + ASIO SDK.
- Der ASIO-Client heißt immer `opencast-client-asio.exe`.
- Es gibt genau eine produktive ASIO-Implementierung (`client/`). Parallelpfade (`backend/`) werden
  entweder synchron gehalten oder entfernt.

## Governance
Diese Constitution schlägt Einzelwünsche in Specs, Plänen und Tasks. Änderungen erfolgen explizit
und getrennt von Feature-Arbeit, mit Begründung in der Versionszeile.

**Version**: 1.0.0 | **Ratified**: 2026-10-03 | **Last Amended**: 2026-10-03
