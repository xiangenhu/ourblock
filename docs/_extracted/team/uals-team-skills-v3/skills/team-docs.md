---
description: Author, refresh & demo project documentation
argument-hint: [audit | api | guides | demo <feat> | refresh <file>]
---

# Team Docs

Author, refresh, and demo project documentation.

## Target: $ARGUMENTS
Options: "audit" | "api" | "guides" | "demo <feature>" | "refresh <file>"

## Workflow Phases

### Phase 1: Inventory (Parallel)
- **Documentation Specialist**: Existing docs map, gaps, staleness signals
- **Code Documentation Generator**: Docstring / API coverage on public modules
- **Demo Documentation Specialist**: Demo / example coverage per feature

### Phase 2: Write (Sequential)
- **Documentation Specialist**: Draft new or refresh stale guides
- **Code Documentation Generator**: Add / update docstrings on touched modules
- **Demo Documentation Specialist**: Author runnable examples

### Phase 3: Verify (Sequential)
- **Documentation Specialist**: Cross-check links, code samples, env-var references

## Generic Doc Principles

- **Docs live with the code** — colocate where possible; cross-link from a central index
- **Examples are runnable** — copy-paste should work; CI should verify
- **Audience-aware** — separate quick-start, reference, and deep-dive material
- **Single source of truth** — never duplicate the same info in two places
- **Auto-generated where possible** — API references from code, not hand-maintained

## Common Staleness Signals

- Code samples reference functions/files that no longer exist
- Env var lists out of sync with what the app actually reads
- Migration guides for versions long-since-shipped
- Architecture diagrams showing components that have been merged or split
- "Coming soon" sections older than 6 months
- TODOs in docs older than 6 months

## Doc Types to Maintain

| Type | Audience | Update Trigger |
|------|----------|----------------|
| README | First-time contributor | Setup steps change |
| Architecture | Engineers | Major design change |
| API reference | Integrators | Public API change |
| Runbooks | On-call | Incident response evolves |
| Migration guides | Upgraders | Breaking changes ship |
| Examples / demos | Users | Feature changes |

## Output Format

```
## Documentation Report

### Coverage
| Doc | Last Updated | Status | Issues |
|-----|--------------|--------|--------|

### Created
- [path] — [topic]

### Refreshed
- [path] — [changes]

### Broken Refs Found
- [doc] → [target] — [reason]

### Docstring Coverage
- Before: [%] — After: [%]
```

- Learning-first UX (entry jargon, focus over density, in-place LLM help, tabs/modals): `@.claude/commands/_shared/learning-ux.md`
