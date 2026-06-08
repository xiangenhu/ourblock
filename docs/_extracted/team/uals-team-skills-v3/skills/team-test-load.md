---
description: Load testing & benchmarking under concurrency
argument-hint: [<endpoint> | <service> | full]
---

# Team Test Load

Load testing and performance benchmarking under realistic concurrency.

## Target: $ARGUMENTS
Options: endpoint path | service | "full"

## Workflow Phases

### Phase 1: Profile (Sequential)
- **Performance Test Runner**: Define scenarios, RPS targets, p50/p95/p99 SLOs

### Phase 2: Execute (Parallel)
- **Load Test Simulator**: Run scripts at target concurrency (k6 / Artillery / Locust / etc.)
- **Performance Metrics Collector**: Capture latency, throughput, error rate

### Phase 3: Diagnose (Sequential)
- **Performance Test Runner**: Identify bottlenecks (CPU, memory, network, DB, downstream)

## Generic Load-Test Patterns

- **Ramp gradually**, then sustain — instant spikes hide warm-up effects
- **Test cold and warm states separately** — first-request cost differs from steady-state
- **Saturate before measuring SLO** — a system far below capacity tells you nothing about p99
- **Watch for resource contention**, not just latency — DB connection pool exhaustion, file descriptors, GC pressure
- **Include downstream rate limits** in scenarios — provider quotas, third-party SLAs
- **Test failure modes**, not just success — timeouts, retries, backoff, circuit breakers

## Output Format

```
## Load Test Report

### Scenario Results
| Scenario | RPS | p50 | p95 | p99 | Error % |
|----------|-----|-----|-----|-----|---------|

### SLO Breaches
- [endpoint] — [metric] — [actual vs target]

### Bottlenecks Identified
1. [system] — [resource] — [recommended fix]

### Recommended Tuning
- [setting] — [current] → [proposed]
```
