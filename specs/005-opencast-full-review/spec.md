# Feature Specification: Opencast — Gesamtprüfung mit Spec Kit und OpenSpec

**Feature Branch**: `005-opencast-full-review` (Arbeitsbranch: `claude/tender-cerf-aghk3j`)
**Created**: 2026-10-03
**Status**: Draft
**Input**: "Prüfe mit Speckit und OpenSpec gründlich Opencast"
**Baut auf**: `001`–`004` (ASIO-Tiefe). Diese Runde deckt das **ganze Projekt** ab: Server, Frontend, Docker/CI, Altbestand `backend/`.

## Rollenverteilung der beiden Werkzeuge (so wie hier eingesetzt)
| | Spec Kit (`.specify/`, `specs/`) | OpenSpec (`openspec/`) |
|---|---|---|
| Zweck in dieser Prüfung | Constitution (Prüfmaßstab), Review-Berichte mit Befunden, Belegen, Reproduktion | **Lebende Verhaltens-Specs** (Ist-Zustand) und **Change-Vorschläge** (Soll-Zustand) |
| Ergebnis | `specs/001…005/*` | 12 Basis-Specs (68 Anforderungen), 8 Changes (Deltas, Design, Aufgaben) |
| Prüfung durch Werkzeug | `/speckit-analyze` (Querprüfung Spec/Plan/Tasks) | `openspec validate --all --strict`, `openspec archive` (Deltas lassen sich zusammenführen) |

## User Scenarios & Testing

### User Story 1 - Ist-Verhalten ist spezifiziert und belegt (Priority: P1)
Ich will für jedes Teilsystem eine Spec, die beschreibt, was Opencast heute tut, und wissen, ob der Code sie einhält.

**Independent Test**: `openspec validate --specs --strict` und `repro/run.sh spec`.

**Acceptance Scenarios**:
1. **Given** die 12 Basis-Specs, **When** `openspec validate --specs --strict` läuft, **Then** bestehen alle.
2. **Given** die Server-seitigen Szenarien, **When** `repro/run.sh spec` läuft, **Then** bestehen alle 11 Konformitätstests.

### User Story 2 - Jeder Befund hat einen Änderungsvorschlag (Priority: P1)
Ich will, dass jeder nachgewiesene Mangel als OpenSpec-Change mit Delta-Spec, Design und Aufgaben vorliegt.

**Acceptance Scenarios**:
1. **Given** die 8 Changes, **When** `openspec validate --all --strict` läuft, **Then** bestehen alle 20 Prüfungen.
2. **Given** alle Changes in Reihenfolge, **When** sie in einer Kopie archiviert werden, **Then** entstehen 13 gültige Specs mit 108 Anforderungen ohne Konflikt.

### User Story 3 - Befunde sind reproduzierbar (Priority: P1)
Server-Befunde laufen unter Linux gegen den echten Code.

**Acceptance Scenarios**:
1. **Given** ein frischer Checkout, **When** `repro/run.sh all` läuft, **Then** zeigt Abschnitt B die bestätigten Befunde (S1, S2, S3, W1 rot) und Abschnitt C Race-Detektor-Treffer.

### User Story 4 - Entscheidungshilfe zu den Werkzeugen (Priority: P2)
Ich will wissen, wie ich Spec Kit und OpenSpec künftig nebeneinander oder nur eines benutze.

## Requirements

### Functional Requirements
- **FR-501**: Für jedes Teilsystem existiert eine OpenSpec-Capability mit Purpose, Anforderungen (SHALL) und Szenarien (WHEN/THEN); `openspec validate --strict` besteht.
- **FR-502**: Jede Basis-Anforderung ist mit Status und Methode (ausgeführt / gelesen) in einer Rückverfolgbarkeitsmatrix erfasst.
- **FR-503**: Jeder Befund ist einem OpenSpec-Change zugeordnet oder als bewusst offen markiert.
- **FR-504**: Ausführbare Prüfungen sind unter `repro/` versioniert und laufen ohne Windows.
- **FR-505**: Die Constitution deckt das ganze Projekt ab (Sicherheit, Tests/CI, Quelle der Wahrheit).
- **FR-506**: Die Grenzen der Prüfung (nicht ausgeführte Teile) sind benannt.

### Key Entities
- **Capability** (`openspec/specs/<name>/spec.md`), **Change** (`openspec/changes/<name>/`: proposal, design, tasks, Delta-Specs).
- **Befund** (F-nn): Fundstelle, Konfidenz, Belegmethode, Change.

## Success Criteria
- **SC-501**: 12 Specs und 8 Changes bestehen `openspec validate --all --strict`.
- **SC-502**: 68 von 68 Basis-Anforderungen in der Matrix mit Status.
- **SC-503**: 100 % der Befunde F-31…F-38 einem Change zugeordnet.
- **SC-504**: `repro/run.sh all` läuft unter Linux ohne Windows/ASIO.

## Assumptions
- Basis-Specs beschreiben das **tatsächliche** Verhalten (Brownfield-Vorgehen von OpenSpec); Abweichungen vom Wunschverhalten stehen in den Change-Deltas.
- Client-/ASIO-Anforderungen konnten nur gelesen werden (kein Windows, kein MinGW, kein SDK).
- Docker war nicht verfügbar; Image-Build und `docker compose` wurden nicht ausgeführt.
