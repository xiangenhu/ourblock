---
description: Triage & resolve a production incident
argument-hint: <symptom description>
---

# Team Incident

Triage and resolve a production incident.

## Incident: $ARGUMENTS
Free-form description of the symptom.

## Workflow Phases

### Phase 1: Triage (Parallel)
- **Error Tracking**: Recent error spikes, top stack traces
- **Log Aggregation**: Query logs around incident window, correlate with deploys

### Phase 2: Hypothesize (Sequential)
- **Error Tracking**: Propose root cause(s) with evidence

### Phase 3: Mitigate (Sequential)
- **Error Tracking**: Recommend immediate mitigation (rollback / flag / config change)

### Phase 4: Postmortem (Sequential)
- **Error Tracking**: Draft postmortem doc with timeline + action items

## Generic Incident Patterns

- **Recent deploy**: First suspect. Roll back; investigate after.
- **Provider / dependency outage**: Check status pages; circuit-break or fail open
- **Rate limit / quota**: Throttle clients, rotate credentials, request quota increase
- **Auth misconfiguration**: Cookie/CORS domain mismatch, token expiry
- **Resource exhaustion**: Connection pool, file descriptors, memory leak
- **Stampede / thundering herd**: Cache miss cascade — add single-flight / coalescing
- **Data inconsistency**: Stale cache, replication lag, partial writes

## Mitigation Priority

1. **Stop the bleeding** — restore service before understanding cause
2. **Preserve evidence** — capture logs/traces/dumps before fixing
3. **Communicate** — keep stakeholders updated even if root cause is unknown
4. **Investigate** — only after impact is contained

## Output Format

```
## Incident Report

### Summary
- Detected: [timestamp]
- Severity: [P0/P1/P2]
- Impact: [users / scope]

### Timeline
- [time] — [event]

### Root Cause
[Description with evidence]

### Mitigation Applied
- [action] — [time]

### Action Items
1. [owner] — [item] — [due]
```

## Scope note
Live production firefighting (rollback, mitigate, postmortem). For working the steady-state
captured-bug queue (read → fix → close from the BUG_LRS) use `/team-bugfix`.
