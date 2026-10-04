# Specification Analysis Report — Opencast Gesamtprüfung (Spec Kit + OpenSpec)

**Konfidenz**: **V** = durch Ausführung nachgewiesen (echter Code) · **L** = aus Code gelesen · **P** = plausibel, braucht Windows/Hardware.
Reproduktion: [repro/run.sh](./repro/run.sh). Spezifikationen: `openspec/specs/`. Änderungsvorschläge: `openspec/changes/`.

## 1. Was geprüft und ausgeführt wurde
| Bereich | Lesen | Ausführung in dieser Sitzung | Ergebnis |
|---|---|---|---|
| Server (Go, 1 910 Zeilen) | vollständig | `go build`, `go vet`, `go test -race` | Build/Vet ok; **0 Testdateien** |
| Server-Verhalten | — | 11 Konformitätstests gegen den echten Code, 7 Befund-Tests (`repro/`) | 11/11 grün; Befunde bestätigt (Abschnitt 2) |
| Frontend (React/Vite, 1 899 Zeilen) | Hooks, Token, API, Kanalauswahl | `npm ci`, `tsc --noEmit`, `vite build`, `npm audit --omit=dev` | alles ok; 0 bekannte Schwachstellen in Produktionsabhängigkeiten; **keine Tests, kein Lint** |
| Client Hub/Session/Buffer | vollständig | 24 bestehende Tests unter Linux per Overlay mit `-race` (004) | grün |
| Client ASIO (C++/CGO) | vollständig (001–003) | nicht kompilierbar hier (kein MinGW/SDK) | nur gelesen |
| Docker/CI/README | vollständig | nicht ausgeführt (kein Docker) | nur gelesen |
| `backend/` (Altbestand) | Struktur, Auth, ASIO-Kopie | — | nicht Teil des Release (CI baut `server/`, `client/`) |
| OpenSpec | — | `openspec validate --all --strict`; Archivierung aller Changes in einer Kopie | 20/20 gültig; Ergebnis 13 Specs, 108 Anforderungen |

## 2. Neue Befunde dieser Runde (ab F-31)
| ID | Schwere | Konf. | Fundstelle | Befund | Change |
|----|---------|-------|------------|--------|--------|
| **F-31** | **HIGH** | **V** | `server/internal/api/server.go:311-326`, `config/config.go:98` | `GET /api/config` liefert das **Icecast-Passwort im Klartext**, ohne Authentifizierung (Test S-1). `server.json` wird mit `0644` geschrieben (weltlesbar). | `secure-api-access` |
| **F-28** (erweitert) | **HIGH** | L | `server/main.go`, `frontend/src/components/TokenGate.tsx`, `lib/api.ts` | `WithAuth` ist ungenutzt (nur `backend/` nutzt es). `TokenGate` ist **nicht eingebunden**, ihr Hinweis "Token im Backend-Terminal" stammt aus `backend/`; und selbst eine Prüfung ergäbe immer 200, weil der Server den Header ignoriert. `apiFetch` und `wsUrl` senden keinen Token. Der Zugangsschutz existiert nur als Attrappe. | `secure-api-access` |
| **F-32** | **HIGH** | **V** | `server/internal/icecast/client.go:129-157, 186-200` | Name, Beschreibung, Genre, URL, Mountpunkt und Content-Type gehen **per `Sprintf` roh** in den Request an Icecast. Ein `\r\n` im Namen erzeugt einen zusätzlichen Header (Test S-2); mit Leerzeile lassen sich Request-Teile abschneiden oder anhängen. Eingabe kommt über die unauthentifizierte API. Zusammen mit freier `host`/`port`-Angabe ist der Server ein Weiterleiter für beliebige TCP-Ziele (SSRF). | `harden-icecast-source` |
| **F-33** | MEDIUM | **V** | `icecast/client.go:73-85, 309, 353` | `UseSSL=true` wirkt nur auf Metadaten- und Statistik-Abfragen. Die **Source-Verbindung** (Zugangsdaten und Audio) bleibt Klartext-TCP (Test S-3). Die Einstellung suggeriert Verschlüsselung. | `harden-icecast-source` |
| **F-34** | MEDIUM | **V** | `icecast/client.go:96-104, 222-229` | **Data Race** zwischen `Connect`-Drain-Goroutine (liest `c.conn`), `Disconnect` (schreibt `nil`) und `Write` (Race-Detektor, Tests C-1, S-2, S-3). Folge im Auto-Reconnect-Pfad: Nil-Dereferenz in der Drain-Goroutine möglich; diese hat kein `recover`, der Server würde enden. | `harden-icecast-source` |
| **F-35** | MEDIUM | **V** | `ingest/relay.go:105-116` | `Unregister` prüft `stopCh` mit `select` und schließt danach: nicht atomar. 64 gleichzeitige Aufrufe lösten in ca. jedem 10. Lauf (mit `-race` 12 von 100) `close of closed channel` aus (Test R-1). Aus dem Client-WebSocket-Pfad (`stream:error` → `Unregister`) wäre das nicht durch `Recoverer` abgefangen. | `harden-icecast-source` |
| **F-36** | MEDIUM | **V** | `server/internal/api/websocket_client.go:82-111` | Wird ein neuer `/ws/client` verbunden, bevor der alte als getrennt erkannt ist, sendet der **alte Handler danach** `clientOnline=false`: In 38 bis 40 von 40 Wiederholungen sah der Browser "Client offline", obwohl verbunden (Test W-1). Die UI beendet dann alle Monitore (`App.tsx:248`). Zusätzlich bleiben `devices` und `status` nach Trennung stehen. Der Client erzeugt außerdem die Geräteliste vor Heartbeat/Read-Loop (F-30). | `stabilize-client-presence` |
| **F-37** | MEDIUM | L | `server/main.go:41-44`, `server/internal/api/server.go:107`, `docker-compose.yml`, `README.md` | Die Ingest-URL wird aus `BASE_URL` gebaut, Standard `http://localhost:<PORT>`. Im Standardaufbau (Server in Docker/Unraid, Client auf Windows) zeigt `localhost` auf den Windows-Rechner; `BASE_URL` ist in `docker-compose.yml` auskommentiert. Der Client bevorzugt die vom Server gelieferte URL (`main_windows.go:84-87`), sein Fallback `BuildIngestURL` bleibt ungenutzt. Der erste Stream scheitert ohne Zusatzkonfiguration. README nennt `BASE_URL` "für CORS, Links": stimmt nicht. | `fix-deploy-defaults` |
| **F-38** | MEDIUM | V/L | `.github/workflows/*`, `server/`, `frontend/package.json`, `Dockerfile`, `server/Dockerfile` | **0 Tests im Server**, keine Lint-/Testschritte im Frontend; **keine PR-Prüfung außer Docker-Build** (Client wird erst beim `v*`-Tag kompiliert); eingechecktes `server/dist` weicht vom Frischbuild ab (302 470 vs. 302 799 Byte JS, Ursache unklar); README und Image nennen ffmpeg im Server, der Server nutzt es nicht; `server/Dockerfile` kopiert ein nicht existierendes `frontend/dist`; Container läuft als root; Kommentar in `relay.go:80` sagt 10 s, der Code (`relay.go:87`) wartet 30 s. | `add-ci-and-tests`, `fix-deploy-defaults` |

## 3. Rückverfolgbarkeit Befund → Change (alle Runden)
| Change | Abgedeckte Befunde |
|---|---|
| `secure-api-access` | F-28, F-31 (+ Geräte-ID-Validierung aus 004) |
| `fix-hub-channel-mapping` | F-01, F-23, F-24, F-29, F-04 (Kanalvalidierung) |
| `harden-icecast-source` | F-32, F-33, F-34, F-35 |
| `stabilize-client-presence` | F-30, F-36 |
| `stream-clock-sync` | F-22 |
| `asio-spec-conformance` | F-02, F-03, F-04, F-05, F-07, F-08 (Panel), F-14, F-15, F-16, F-18, F-19, F-21, F-26, F-27 |
| `add-ci-and-tests` | F-12, F-25, F-38 (Tests, CI, dist, ffmpeg) |
| `fix-deploy-defaults` | F-37, F-38 (Image, Doku) |
| **bewusst offen** | **F-20** (Lizenz: Entscheidung des Maintainers), F-17 (`outputReady` erst messen), F-09 (Hub-Callbacks lock-/allokationsfrei — Optimierung nach F-23-Fix), F-10, F-11 (VU-Lücke, Restart-Backoff teilweise in `asio-spec-conformance`), F-13 (`backend/` entfernen), F-06 (Stop-Event pro Instanz) |

## 4. Rückverfolgbarkeit der Basis-Specs (68 Anforderungen)
Methode: **A** = ausgeführt gegen echten Code (Overlay-Läufe/Konformitätstests), **G** = gelesen. ⚠ = Anforderung erfüllt, aber mit einer Einschränkung, die ein Change behebt.

| Capability | Anf. | A | G | ⚠ | Hinweise |
|---|---|---|---|---|---|
| stream-control | 6 | 4 | 2 | 1 | Ingest-URL: Verhalten korrekt, Standard problematisch (F-37) |
| ingest-relay | 6 | 2 | 4 | 1 | Stopp: nicht nebenläufigkeitssicher (F-35) |
| icecast-source | 6 | 2 | 4 | 1 | "Antworten leeren": Data Race (F-34) |
| client-connection | 5 | 4 | 1 | 0 | Verhalten ok; Online-Zustand siehe F-36 (nicht in Basis-Spec, weil Fehlverhalten) |
| browser-realtime | 4 | 2 | 2 | 0 | — |
| audio-capture-hub | 9 | 9 | 0 | 1 | Kanalvereinigung: Zuordnung/Mono fehlerhaft (F-23, F-01) |
| asio-capture | 9 | 0 | 9 | 3 | Ein Treiber (blockiert), Probe (erfundene 32), Wächter (nur Start) |
| device-discovery | 4 | 2 | 2 | 0 | — |
| level-monitoring | 5 | 4 | 1 | 0 | — |
| settings-persistence | 5 | 4 | 1 | 0 | Verhalten ok; Passwort-Ausgabe siehe F-31 |
| web-ui | 5 | 0 | 5 | 1 | Kanalauswahl: bei Probe-Fehler 32 Optionen (F-04) |
| packaging-release | 4 | 0 | 4 | 0 | Build/Release gelesen; Docker nicht ausgeführt |
| **Summe** | **68** | **33** | **35** | **8** | **60 ohne Einschränkung, 8 mit** |

Keine Basis-Anforderung ist **verletzt**, weil die Basis den Ist-Zustand beschreibt; die Fehlverhalten stehen als ADDED/MODIFIED in den Changes. Die 33 ausgeführten Anforderungen sind reproduzierbar (`repro/run.sh spec` für Server, `specs/004-…/repro/run.sh` für den Hub).

## 5. Was gut gelöst ist
- Server-Verhalten entspricht den Spezifikationen: 11/11 Szenario-Tests grün (Start/Stopp, Fehlercodes, verzögerte Icecast-Verbindung, Client-Ersetzung, Nachrichtengröße, Anfangszustand, Karenzzeit der Monitore, Teil-Updates der Konfiguration).
- Browser-Broadcast ist nicht blockierend (Puffer 64, Verwerfen bei vollem Puffer), Ingest-Reader blockiert den Client nicht.
- Frontend: `tsc` und Build sauber, 0 bekannte Schwachstellen in Produktionsabhängigkeiten.
- Konfigurationsdatei-Pfad für Docker (`XDG_CONFIG_HOME=/config`) funktioniert wie dokumentiert (Test).
- Reconnect-Logik des Icecast-Relays (Backoff 1 … 32 s, Stopp bricht ab) ist durchdacht.

## 6. Spec Kit und OpenSpec im Vergleich (so eingesetzt)
| Aspekt | Spec Kit | OpenSpec | Beobachtung hier |
|---|---|---|---|
| Brownfield-Eignung | Pro Feature neue Dokumente, Ist-Zustand muss nachgebaut werden | **Lebende Specs des Ist-Zustands** plus Deltas | OpenSpec war für das bestehende Projekt deutlich passender |
| Prüfung durch das Werkzeug | `/speckit-analyze` (Querprüfung) | `openspec validate --strict`, `archive` | Der Validator fing einen echten Fehler (MODIFIED-Block ließ ein Szenario fallen) |
| Zusammenführbarkeit | keine | Deltas werden beim Archivieren in die Specs gemischt | Alle 8 Changes ließen sich nacheinander archivieren (13 Specs, 108 Anforderungen, 0 Konflikte) |
| Prinzipien/Constitution | **ja** (Gates) | nein (nur `config.yaml`-Kontext) | Constitution v1.2.0 bleibt im Spec Kit |
| Aufgaben | `tasks.md` je Feature | `tasks.md` je Change | Doppelte Aufgabenlisten vermeiden: Aufgaben nur in OpenSpec-Changes (Prinzip XII) |
| Sprache der Specs | frei | Struktur englisch, Inhalt frei (hier Deutsch) | beides ok |
| Aufwand pro Änderung | höher (spec, plan, tasks, analyze) | niedriger (proposal, specs, design, tasks) | |

**Empfehlung**: OpenSpec als führendes System für Verhalten und Änderungen (`openspec/`), Spec Kit nur für Constitution und Review-Berichte (`specs/`, hier abgeschlossen). Neue Arbeit mit `/opsx:propose` starten (Skills sind eingerichtet), Befunde bleiben in `specs/00x/analysis.md` nachvollziehbar.

## 7. Konsolidierte Prioritäten (001–005)
| Prio | Befund | Change |
|---|---|---|
| **P0** | F-31, F-28, F-32 (offene Schnittstellen, Klartext-Passwort, Header-Injektion) | `secure-api-access`, `harden-icecast-source` |
| **P0** | F-23, F-01 (falsche Kanäle, Mono doppelt lang — nachgewiesen) | `fix-hub-channel-mapping` |
| **P0** | F-20 (Lizenz) | Entscheidung |
| **P1** | F-37 (Standard-Setup scheitert), F-36 (UI offline nach Reconnect), F-33, F-34, F-35 | `fix-deploy-defaults`, `stabilize-client-presence`, `harden-icecast-source` |
| **P1** | F-02, F-22, F-03, F-04/F-05/F-30, F-24 | `asio-spec-conformance`, `stream-clock-sync`, `fix-hub-channel-mapping` |
| **P1** | F-38, F-12 (keine Tests/CI) — damit alles andere abgesichert wird | `add-ci-and-tests` |
| **P2** | F-14 … F-19, F-21, F-25 … F-27, F-29 | `asio-spec-conformance`, `add-ci-and-tests` |
| **P3** | F-07, F-08, F-10, F-11, F-13 | `asio-spec-conformance`, offen |

Empfohlene Reihenfolge der Umsetzung: `add-ci-and-tests` (Netz) → `secure-api-access` und `harden-icecast-source` → `fix-hub-channel-mapping` → `stabilize-client-presence` → `fix-deploy-defaults` → `stream-clock-sync` → `asio-spec-conformance` (Hardware-Abnahme).

## 8. Grenzen
- Client-/ASIO-Anforderungen (alle 9 aus `asio-capture`, Web-UI, Packaging) nur gelesen; kein Windows, kein Docker.
- Der Server-Test-Aufbau bildet `main.go` nach (Routen, `SetOnNewClient`); der eingebettete Frontend-Handler (`//go:embed dist`) ist nicht Teil der Tests.
- W-1 simuliert zwei gleichzeitig offene Client-Verbindungen; im Feld tritt es auf, wenn die alte Verbindung bei Netzwechsel/Ruhezustand noch nicht als getrennt erkannt ist.
- Die Race-Funde in `icecast.Client` (F-34) sind vom Race-Detektor belegt; ob der Nil-Dereferenz-Pfad im Feld ausgelöst wird, ist nicht gezeigt.
- OpenSpec 1.14.0 lief aus dem Scratchpad; das Repository enthält nur die erzeugten Dateien (`openspec/`, `.claude/skills/openspec-*`, `.claude/commands/opsx/`).

## 9. Next Actions
1. **Entscheidung** zur Lizenz (F-20) und zum Altbestand `backend/` (entfernen?).
2. `add-ci-and-tests` umsetzen, damit jede weitere Änderung geprüft wird; danach `secure-api-access` (P0).
3. Mit `/opsx:apply` (Claude-Skill) Change für Change umsetzen; vor dem Archivieren `repro/run.sh` und die Hub-Tests aus `specs/004` laufen lassen.
