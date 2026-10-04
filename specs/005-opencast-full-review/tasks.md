# Tasks: Gesamtprüfung — Übergabe an OpenSpec

Fachliche Aufgaben stehen in den OpenSpec-Changes (`openspec/changes/<name>/tasks.md`). Diese Liste enthält nur die **Übergabe- und Verwaltungsaufgaben** der Prüfung selbst.

## Phase 1: Entscheidungen (blockieren Umsetzung nicht, beeinflussen Reihenfolge)
- [ ] T501 [F-20] Lizenzweg für das ASIO SDK wählen (Steinberg-Lizenz oder GPLv3), `LICENSE` und Markenhinweis anlegen
- [ ] T502 [F-13] Altbestand `backend/` entfernen oder dokumentiert einfrieren (Makefile verweist noch darauf)
- [ ] T503 [F-24] Entscheidung (a) alle Kanäle öffnen oder (b) Monitor wartet — in `fix-hub-channel-mapping/design.md` eintragen

## Phase 2: Werkzeuge
- [ ] T510 `openspec validate --all --strict` in die CI (Job `specs`) aufnehmen
- [ ] T511 Konformitätstests des Servers aus `repro/server_conformance_test.go.txt` als reguläre Tests übernehmen (Teil von `add-ci-and-tests`, Aufgabe 3.1)
- [ ] T512 `CLAUDE.md` um Abschnitt "Spezifikations-Workflow" ergänzen (siehe unten, erledigt)

## Phase 3: Umsetzung (Reihenfolge laut plan.md)
- [ ] T520 `add-ci-and-tests` · [ ] T521 `secure-api-access` · [ ] T522 `harden-icecast-source` · [ ] T523 `fix-hub-channel-mapping`
- [ ] T524 `stabilize-client-presence` · [ ] T525 `fix-deploy-defaults` · [ ] T526 `stream-clock-sync` · [ ] T527 `asio-spec-conformance`

## Abhängigkeiten
T520 vor allen anderen Umsetzungen · T511 gehört zu T520 · T503 vor T523 (Teilaufgabe 2.4) · T501 unabhängig.

## Coverage
FR-501 ✔ (12 Specs gültig) · FR-502 ✔ (analysis.md §4) · FR-503 ✔ (analysis.md §3) · FR-504 ✔ (`repro/`) · FR-505 ✔ (Constitution 1.2.0) · FR-506 ✔ (analysis.md §8).
