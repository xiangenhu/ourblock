---
description: Audit & prioritize technical debt
argument-hint: [full | <module> | recent changes]
---

# Team Debt

Audit and prioritize technical debt across the codebase.

## Scope: $ARGUMENTS
Options: full | module | "recent changes"

## Workflow Phases

### Phase 1: Discovery (Parallel)
- **Technical Debt Tracker**: Pull existing debt register
- **Code Smell Detector**: Surface new smells
- **Static Code Analyzer**: Complexity and maintainability metrics
- **Dead Code Eliminator**: Unused code, unreachable branches

### Phase 2: Prioritization (Sequential)
- **Architect**: Risk × cost ranking; identify load-bearing debt

### Phase 3: Roadmap (Sequential)
- **Technical Debt Tracker**: Update register; generate burn-down plan

## Generic Debt Hotspots

- **Duplicate code paths** doing the same thing in different places
- **Direct calls to external SDKs** that bypass a gateway/abstraction layer
- **Cached data treated as source of truth** when authoritative store is elsewhere
- **Manually constructed payloads** that should use a builder/schema
- **Deprecated APIs** still in active use
- **Backwards-compat shims** retained after their use case is gone
- **Custom code where a well-supported library exists** (or vice versa)

## Output Format

```
## Technical Debt Report

### Debt Inventory
| ID | Item | Severity | Effort | Risk if Ignored |
|----|------|----------|--------|-----------------|

### Top 5 Pay-Down Priorities
1. [item] — [why]

### Quick Wins (< 1 day each)
- [item]

### Architectural Debt (> 1 week)
- [item]
```

## Shared references
Code-quality signals and the four-command disambiguation table live in one place — pull them in:
`@.claude/commands/_shared/code-quality.md`
