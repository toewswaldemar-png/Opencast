# Prüfbericht Liedanzeige (Stand: Commit d2bc0ab)

Geprüft: Frontend `StreamCard.tsx`/`App.tsx`, Server `api/server.go`, `ingest/relay.go`, `icecast/client.go`,
eingebettetes `server/dist`, `Makefile`/`Dockerfile`. `go build ./...` und `go vet` für `server/` laufen sauber.
Der Ist-Stand ist in `openspec/specs/now-playing/spec.md` spezifiziert und erfüllt (5/5 Anforderungen).
`server/dist` enthält denselben Code wie `StreamCard.tsx` (Endpoint, 800 ms Debounce, Resend).

## Bestätigt durch Test (temporärer `httptest`-Test, danach entfernt)
| # | Schwere | Befund |
|---|---------|--------|
| 1 | mittel | `UpdateMetadata` sendet `mount=stream`, wenn der Mountpoint ohne `/` konfiguriert ist; Handshake und `ListenerCount` normalisieren, nur das Update nicht → Titel wird nie gesetzt. |
| 2 | mittel | Kein `charset`-Parameter; laut Icecast-Doku ist der Default für MP3-Mounts ISO-8859-1, Umlaute können verfälscht ankommen. (Nicht gegen echten Icecast geprüft.) |

## Durch Code-Lektüre festgestellt
| # | Schwere | Befund |
|---|---------|--------|
| 3 | mittel | `App.tsx` rendert Karten nur in der Kartenansicht (`showSettings ? … : …`). Wechsel in die Einstellungen hängt `StreamCard` aus, `nowPlaying` (lokaler State) und ein ausstehender Debounce-Timer gehen verloren. Icecast zeigt weiter den alten Titel. |
| 4 | mittel | `fetch` wirft bei HTTP 4xx/5xx nicht; `.catch(() => {})` verschluckt alles. Schlägt das Update fehl (z. B. Mount direkt nach Connect noch nicht bereit, Icecast 401/404), sieht der Bediener nichts und es gibt keinen Retry. |
| 5 | niedrig | Seiten-Reload: Titel nicht persistiert, Eingabefeld leer, Hörer sehen weiter den alten Titel. Kein Readback (`status-json.xsl` liefert `title`). |
| 6 | niedrig | Protokoll `shoutcast` nutzt trotzdem die Icecast-Admin-URL → Update funktioniert dort nicht. |
| 7 | niedrig | Format `ogg` (Vorbis): Metadaten sind Stream-Kommentare, `updinfo` greift laut Icecast-Doku nicht; UI bietet das Feld dennoch an. |
| 8 | niedrig | `HandleMetadata`: keine Prüfung auf leere `streamId`, keine Längen-/Body-Begrenzung, kein Trimmen; "nicht aktiv" und Icecast-Fehler werden beide als 400 gemeldet (statt 404/502). |
| 9 | niedrig | Ein Titel aus der vorigen Sitzung wird beim nächsten Live-Gehen automatisch erneut gesendet (nur solange die Seite nicht neu geladen wurde). Als Verhalten spezifizieren oder bewusst anders lösen. |
| 10 | niedrig | Ist der Stream innerhalb der 800 ms Debounce-Zeit beendet, wird der Timer trotzdem ausgelöst und scheitert still mit HTTP 400. |

## Build / Betrieb
| # | Schwere | Befund |
|---|---------|--------|
| 11 | mittel | `Makefile` (`make build`/`run`) baut `backend/`, das keine Liedanzeige enthält (kein `/api/stream/metadata`, kein `UpdateMetadata`). Dockerfile und CLAUDE.md verwenden `server/`. `backend/` ist veraltet. |

## Tests
Für die Liedanzeige existieren keine Tests (weder Go noch Frontend). Siehe Tasks 1.4, 2.3.
