---
description: Build/validate analytics + APM dashboards
argument-hint: [report | dashboard | apm | custom-query]
---

# Team Analytics

Build, validate, and explain analytics + APM dashboards.

## Target: $ARGUMENTS
Options: "report" | "dashboard" | "apm" | "custom-query"

## Workflow Phases

### Phase 1: Define (Sequential)
- **Data Analyst**: Define metrics, dimensions, target audience

### Phase 2: Build (Parallel)
- **Data Analyst**: Compose targeted queries
- **APM Integration**: Hook performance signals into dashboards
- **Performance Metrics Collector**: Add custom counters / timers if needed

### Phase 3: Validate (Sequential)
- **Data Analyst**: Sanity-check totals, spot-check vs raw events

## Generic Analytics Principles

- **Targeted queries with explicit filters** — never read whole event streams into memory
- **Filter at the data store, not in the app** — server-side filtering is orders of magnitude faster
- **Define metrics in one place** — keep query logic in a shared module, not duplicated per dashboard
- **Dimensions over data** — design for slicing by user, time, segment, version
- **Validate against raw events** before publishing a dashboard
- **Document sample size limits** so consumers understand confidence intervals

## Common Query Patterns

| Goal | Approach |
|------|----------|
| User behavior | Filter by user identity + action type + time window |
| Funnel analysis | Sequence of events per user, ordered by timestamp |
| Cohort retention | Group users by signup window, measure activity over time |
| A/B split | Filter by experiment variant; compare metrics |
| Performance by segment | Group by segment dimension; aggregate metric |

## Output Format

```
## Analytics Deliverable

### Metric Definitions
- [metric]: [formula]

### Query Strategy
- Filters: [list]
- Estimated cost: [latency, event count]

### Visualization
- Type: [chart/table]
- Audience: [role]

### Validation
- Sample size: [N]
- Spot check: [pass/fail]
```
