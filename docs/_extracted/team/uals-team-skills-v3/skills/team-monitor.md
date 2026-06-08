---
description: Observability & health monitoring across the stack
argument-hint: [setup | dashboard | alerts | audit]
---

# Team Monitor

Observability and health monitoring across the stack.

## Target: $ARGUMENTS
Options: "setup" | "dashboard" | "alerts" | "audit"

## Workflow Phases

### Phase 1: Inventory (Parallel)
- **Uptime Monitor**: External probes, status page coverage
- **Health Check Coordinator**: `/health` endpoints per service, dependency checks
- **APM Integration**: Trace coverage, instrumentation gaps
- **Performance Metrics Collector**: Counter / histogram inventory

### Phase 2: Configure (Sequential)
- **Health Check Coordinator**: Wire health checks into uptime probes
- **APM Integration**: Add missing spans / attributes

### Phase 3: Alert (Sequential)
- **Uptime Monitor**: Define alert thresholds, on-call routing

## Generic Observability Principles

- **Three pillars: logs, metrics, traces** — all should correlate by request ID
- **SLI → SLO → SLA** — define what you measure, what you target, what you commit to
- **Alert on symptoms, not causes** — page on user-facing impact (latency, errors), not infrastructure metrics that *might* cause impact
- **Every alert has a runbook** — if you can't write what to do, the alert isn't actionable
- **Health checks distinguish liveness from readiness** — alive ≠ ready to serve
- **No silent failures** — every error path emits a signal

## Recommended Alert Categories

| Category | Example Signal | Severity |
|----------|---------------|----------|
| Availability | Health check fails 2 consecutive | P1 |
| Error rate | > 5% over 5m | P1 |
| Latency | p95 above SLO for 10m | P2 |
| Downstream | Provider error rate > N% | P2 |
| Saturation | CPU/memory > 80% sustained | P3 |
| Business | Conversion / hit rate drops | P3 |

## Output Format

```
## Monitoring Audit

### Coverage
| Service | Health | Traces | Metrics | Alerts |
|---------|--------|--------|---------|--------|

### Gaps
- [service/signal] — [why it matters]

### Alert Definitions
- [alert] — [condition] — [destination]

### Recommended Dashboards
1. [dashboard] — [audience]
```
