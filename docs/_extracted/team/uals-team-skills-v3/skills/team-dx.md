---
description: Improve onboarding & inner-loop dev speed
argument-hint: [onboarding | inner-loop | tooling | audit]
---

# Team DX (Developer Experience)

Improve onboarding, local dev workflow, and inner-loop speed.

## Target: $ARGUMENTS
Options: "onboarding" | "inner-loop" | "tooling" | "audit"

## Workflow Phases

### Phase 1: Audit (Parallel)
- **Developer Experience Specialist**: Onboarding friction, doc gaps
- **Development Workflow Specialist**: Local dev cycle time, hot-reload, test feedback

### Phase 2: Fix (Sequential)
- **Developer Experience Specialist**: Remove friction (scripts, READMEs, defaults)
- **Development Workflow Specialist**: Tune watchers, linting speed, IDE config

## Generic DX Goals

- **Time-to-first-success** — new contributor goes from `git clone` to running app in under 15 minutes
- **Single command setup** — `<install> && <bootstrap>` does everything; no manual steps
- **Fast feedback** — file save to test result in seconds, not minutes
- **Clear error messages** — when something fails, the message tells the dev exactly what to do
- **No magic** — every script in the project is documented or self-explanatory
- **Reproducible** — same setup on every machine; pinned versions; no "works on my machine"

## Common Friction to Eliminate

- Missing env vars discovered at runtime — fail fast at startup with a clear list
- Tests that depend on real external services — provide mocks or fakes
- Slow watchers / restarts — profile and tune
- Linter that complains on commit but not in editor — wire it in both
- Dependencies that need manual install — bundle in setup script
- Stale caches — provide a clean reset command

## Output Format

```
## DX Report

### Onboarding Time
- Before: [minutes to first successful run]
- After: [minutes]

### Inner-Loop Time
- File save → test feedback: [seconds]
- File save → reload: [seconds]

### Friction Removed
- [item]

### Remaining Friction
- [item] — [why deferred]
```
