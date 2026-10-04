# Implementation Plan: Gesamtprüfung dauerhaft verankern

**Spec**: [spec.md](./spec.md) | **Analyse**: [analysis.md](./analysis.md) | **Constitution**: v1.2.0
**Art**: Vorgehensplan. Die eigentlichen Arbeitspakete stehen **in den OpenSpec-Changes** (Prinzip XII), nicht hier.

## Technical Context
- OpenSpec 1.14.0 (Schema `spec-driven`, Sprache `de`), Skills/Commands für Claude Code unter `.claude/skills/openspec-*` und `.claude/commands/opsx/`.
- Spec Kit 1.1.1 (Claude-Integration), Constitution in `.specify/memory/constitution.md`.
- Ausführbare Prüfungen: `specs/004-…/repro/run.sh` (Hub), `specs/005-…/repro/run.sh` (Server).

## Constitution Check (v1.2.0)
| Prinzip | Status |
|---|---|
| X Grenzen authentifiziert/validiert | ✗ F-28, F-31, F-32 |
| XI Tests und CI | ✗ F-38, F-12 |
| XII Eine Quelle der Wahrheit | ✔ eingerichtet (`openspec/`); Aufgaben nur in Changes |
| I–IX | siehe 001–004 |

## Reihenfolge
1. `add-ci-and-tests` — Netz zuerst; danach laufen die Tests aus `repro/` als reguläre Tests.
2. `secure-api-access`, `harden-icecast-source` — Sicherheit (P0).
3. `fix-hub-channel-mapping` — nachgewiesene Logikfehler (P0).
4. `stabilize-client-presence`, `fix-deploy-defaults` — Betrieb (P1).
5. `stream-clock-sync` — nach Messung auf Hardware.
6. `asio-spec-conformance` — größter Block, Hardware-Abnahme.

## Arbeitsweise pro Change
`/opsx:apply <change>` → rote Tests übernehmen → Umsetzung → `openspec validate --all --strict` → `repro/run.sh` und Hub-Tests → `/opsx:archive` (Deltas fließen in `openspec/specs/`).

## Risiken
- Zwei Systeme können auseinanderlaufen: Spec-Kit-Berichte sind Momentaufnahmen, `openspec/specs` ist lebend. Regel: Berichte nicht nachpflegen, neue Befunde als Change oder Issue.
- Basis-Specs beschreiben Ist-Verhalten, auch wo es unbefriedigend ist; sie müssen nach jedem Archivieren gegengelesen werden.
