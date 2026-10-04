# Design

## Context

`s.baseURL` wird bei jedem Start verwendet; `main.go` setzt den Standard `http://localhost:<PORT>`. Der Client bevorzugt `p.IngestURL`, sonst `BuildIngestURL`.

## Goals / Non-Goals

**Goals:**
- Out-of-the-box funktionierender Aufbau Server-in-Docker + Windows-Client.
- Dokumentation entspricht dem Verhalten.

**Non-Goals:**
- Automatische Erkennung der externen Adresse hinter Proxys.

## Decisions

1. `BASE_URL` leer → `ingestUrl` leer im `cmd:start`; der Client baut `serverUrl + /ingest/<id>` (Fallback existiert).
2. `BASE_URL` gesetzt → unverändert (für Aufbauten mit Reverse Proxy).
3. Image: `ffmpeg` entfernen, `USER` nicht root, `HEALTHCHECK` auf `/api/status`.

## Risks / Trade-offs

- Betreiber, die sich auf den bisherigen Standard `localhost` verlassen, merken nichts (Client-Fallback nutzt die erreichbare URL).
