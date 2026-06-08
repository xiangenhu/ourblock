---
description: End-to-end browser tests for user journeys
argument-hint: [<journey> | all]
---

# Team Test E2E

End-to-end browser tests for critical user journeys.

## Target: $ARGUMENTS
Options: journey name | "all"

## Workflow Phases

### Phase 1: Journey Mapping (Sequential)
- **User Journey Specialist**: Define critical paths and decision points

### Phase 2: Test Authoring (Parallel)
- **E2E Test Orchestrator**: Author scripts (Playwright/Cypress/Puppeteer — pick what the project uses)
- **QA Testing**: Define assertions and visual regression baselines

### Phase 3: Execute (Sequential)
- **E2E Test Orchestrator**: Run against the local or preview environment

## General E2E Guidelines

- **Pick journeys, not pages** — tests follow a user task end-to-end, not isolated screens
- **Use stable selectors** — `data-testid` attributes, never CSS class names or text strings
- **Wait for events, not timeouts** — assert on network idle, element state, or explicit signals
- **Seed data deterministically** — every test starts from a known state and tears down cleanly
- **Authentication is mocked or test-scoped** — don't rely on real production accounts
- **Visual regression baselines** are pinned per browser/viewport, not shared across configs
- **Failure artifacts** (screenshots, traces, logs) are captured automatically for every failure

## Output Format

```
## E2E Test Report

### Journeys Covered
- [journey] — [N steps, M assertions] — [pass/fail]

### Failures
- [step] — [expected vs actual]

### Flaky Tests
- [test] — [flake rate]

### Visual Regressions
- [page] — [diff %]
```

## Project invariants
- Author per-role journeys + negative authz cases (learner≠learner, educator≠foreign class, admin-only config): `@.claude/commands/_shared/roles.md`
