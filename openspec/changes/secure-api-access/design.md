# Design

## Context

Der Server ist für das LAN gedacht (`0.0.0.0`), aber ohne Zugangsschutz. Die vorhandene Middleware `WithAuth` (Bearer oder `?token=`) wird nicht benutzt. Der Client wählt COM-Klassen anhand von IDs, die über den Server von außen kommen.

## Goals / Non-Goals

**Goals:**
- Kein unauthentifizierter Zugriff auf Steuerung, Konfiguration, Geräteliste und Streams.
- Keine Geheimnisse in Antworten.
- Der Client lädt nur COM-Klassen, die er selbst als ASIO-Treiber gelistet hat.

**Non-Goals:**
- Benutzerverwaltung, Rollen, TLS-Terminierung (Reverse Proxy bleibt Sache des Betreibers).

## Decisions

1. **Token statt Benutzerkonten:** ein gemeinsamer Token (`TokenAuth`, vorhanden). Vergleich in konstanter Zeit (`subtle.ConstantTimeCompare`). Alternative (Basic Auth) verworfen, weil WebSockets im Browser keine Header setzen können.
2. **Token-Transport:** `Authorization: Bearer` für HTTP; für WebSockets `?token=` (vorhandene Funktion). Tokens in Logs maskieren (`middleware.Logger` loggt die URL).
3. **Ingest:** `StartRequest` erzeugt ein einmaliges Geheimnis, das der Server in die Ingest-URL einbettet und beim PUT prüft. Der Client erhält die URL über seinen authentifizierten WebSocket.
4. **Passwörter:** `GET /api/config` gibt `passwordSet: true` statt des Werts aus; `PUT` ohne Passwortfeld behält den alten Wert.
5. **Client-Allowlist:** `registry.Hub(id)` und `StartStream/Subscribe/OnAsioPanel` prüfen die ID gegen `asioDevices`/zuletzt gesendete Liste; ASIO-CLSID zusätzlich per Regex.

## Risks / Trade-offs

- Breaking für bestehende Installationen (einmalige Token-Eingabe).
- `?token=` in URLs landet in Proxy-Logs; empfohlen: HTTPS vor dem Server.
- Ingest-Geheimnis erfordert Anpassung am Client-PUT (URL ist bereits vollständig, daher gering).
