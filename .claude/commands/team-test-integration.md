---
description: Integration tests across module boundaries
argument-hint: [<route prefix> | <service> | all]
---

# Team Test Integration

Build and run integration tests across module boundaries.

## Target: $ARGUMENTS
Options: route prefix | service name | "all"

## Workflow Phases

### Phase 1: Plan (Sequential)
- **Integration Testing Specialist**: Map cross-module contracts and seams

### Phase 2: Generate (Parallel)
- **Integration Test Coordinator**: Wire fixtures and test scaffolding
- **Unit Test Generator**: Fill in module-level tests for new seams

### Phase 3: Run (Sequential)
- **QA Testing**: Execute, capture failures, isolate flaky tests

## Generic Integration Seams to Verify

- **Service-to-service contracts** — request/response shapes match across boundaries
- **Auth/identity propagation** — caller identity flows correctly to downstream
- **Persistence layer** — reads see writes; transactions roll back correctly
- **External SDK adapters** — request construction, error mapping, retry behavior
- **Background jobs / queues** — message format, retry, dead-letter behavior
- **Middleware ordering** — auth, logging, validation, error handling apply in correct order

## Output Format

```
## Integration Test Report

### Coverage Map
| Seam | Tests | Pass | Fail |
|------|-------|------|------|

### Failures
- [test] — [seam] — [root cause]

### Contract Mismatches Found
- [caller] expects [shape], [callee] returns [shape]

### Recommended Fixes
1. [fix]
```
