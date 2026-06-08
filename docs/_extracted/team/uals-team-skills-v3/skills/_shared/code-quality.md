# Shared Reference: Code-Quality Signals

Canonical smell/debt lists. Referenced by `/team-review`, `/team-clean`, `/team-debt`,
`/team-refactor` via `@.claude/commands/_shared/code-quality.md`. Edit here once.

## Smells (Code Smell Detector)
God classes/objects · feature envy · shotgun surgery · long parameter lists ·
primitive obsession · long methods (>50 LOC) · switch-where-polymorphism-fits.

## Static thresholds (Static Code Analyzer)
Cyclomatic complexity >10 · high cognitive complexity · low maintainability index ·
duplication % · functions >50 LOC.

## Debt hotspots
Duplicate code paths · direct SDK calls bypassing a gateway · cached data treated as
source of truth · manually built payloads that should use a schema/builder · deprecated
APIs still in use · backwards-compat shims past their use case · custom code where a
supported library exists (or vice versa).

## Dead-code watch list
Unused exports/files · unreachable branches · orphaned i18n keys · old code paths replaced
by a new system but never deleted · commented-out blocks "just in case" · TODOs >6 months
with no linked issue.

## When-to-use (disambiguates the four quality commands)
| Command | Verb | Mutates code? | Primary output |
|---------|------|---------------|----------------|
| `/team-review`   | **Assess** a diff/dir | No | Prioritized findings |
| `/team-clean`    | **Remove** dead code & fix style | Yes (safe deletions) | Cleanup report |
| `/team-debt`     | **Prioritize** & schedule | No | Ranked debt register |
| `/team-refactor` | **Restructure** behavior-preserving | Yes (large) | Refactor report |
