---
description: Full perf analysis (front+back+cache) & optimization
argument-hint: [<files/dirs> | full]
---

# Team Performance Optimization

Execute full performance analysis and optimization.

## Target: $ARGUMENTS
Options: specific files/directories | "full" for entire codebase

## Workflow Phases

### Phase 1: Measurement (Parallel)
- **Performance Metrics Collector**: Baseline metrics
- **Performance Test Runner**: Performance benchmarks
- **Load Test Simulator**: Concurrent user load

### Phase 2: Analysis (Parallel)
- **Code Optimization Specialist**: Algorithm and code efficiency
- **Loading Performance Specialist**: Page load and resource optimization
- **Data Analyst**: Performance data analysis and patterns

### Phase 3: Implementation (Sequential)
- **Fullstack Developer**: Implement optimizations
- **Architecture Refactoring Specialist**: Larger structural changes

### Phase 4: Validation (Parallel)
- **Performance Test Runner**: Re-run benchmarks
- **Load Test Simulator**: Verify improvements under load

## Performance Focus Areas

### Frontend
- Page load time
- First Contentful Paint (FCP)
- Largest Contentful Paint (LCP)
- Interaction to Next Paint (INP)
- Cumulative Layout Shift (CLS)
- Bundle size, image optimization, resource caching

### Backend
- API response times (p50/p95/p99)
- Database query optimization
- Memory and CPU usage
- Connection pooling
- N+1 query detection

### Caching
- Cache hit rate
- Cache key cardinality
- TTL tuning
- Browser caching headers

## Analysis Checklist

- [ ] Algorithm complexity review
- [ ] Loop / iteration hotspots
- [ ] Memory leak detection
- [ ] Async/await patterns and promise handling
- [ ] Bundle analysis and tree-shaking
- [ ] Lazy loading where beneficial
- [ ] Response compression enabled
- [ ] Caching strategy documented

## Output Format

```
## Performance Optimization Report

### Executive Summary
- Overall score: [score/100]
- Key bottlenecks: [count]

### Baseline Metrics
| Metric | Before | Target | Gap |
|--------|--------|--------|-----|

### Identified Bottlenecks

#### Critical (>50% impact)
1. **[Bottleneck]**
   - Location: [file:line]
   - Impact: [description]
   - Fix: [solution]
   - Expected improvement: [estimate]

#### Moderate / Minor
[same shape]

### Optimization Plan
| Priority | Optimization | Effort | Impact |
|----------|-------------|--------|--------|

### Validation (After Optimization)
| Metric | Before | After | Δ |
|--------|--------|-------|---|

### Long-term Recommendations
1. [item]
```

## Shared references
Cache-key invariants are canonical here — do not restate them, reference them:
`@.claude/commands/_shared/cache-invariants.md`

## Delegation (avoid overlap)
- Frontend Core Web Vitals specifics → run `/team-load` (this command summarizes, does not restate).
- Load/concurrency testing → run `/team-test-load`.
This command orchestrates the full picture; the two above own the detail.
