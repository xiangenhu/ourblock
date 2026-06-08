---
description: Frontend load & runtime performance pass
argument-hint: [page path | all-pages | route group]
---

# Team Load (Frontend Performance)

Improve page load and runtime performance in the browser.

## Target: $ARGUMENTS
Options: page path | "all-pages" | route group

## Workflow Phases

### Phase 1: Measure (Parallel)
- **Loading Performance Specialist**: Lighthouse, Core Web Vitals (LCP, INP, CLS)
- **Performance Metrics Collector**: Bundle sizes, transfer sizes per route

### Phase 2: Optimize (Sequential)
- **Code Optimization Specialist**: Code splitting, lazy loading, asset compression
- **Loading Performance Specialist**: Apply font / image / CSS optimizations

### Phase 3: Verify (Sequential)
- **Loading Performance Specialist**: Re-measure and compare

## Generic Frontend Performance Levers

- **Code splitting** at route boundaries; load only what's needed for the current view
- **Lazy-load** heavy components and analytics after first interactive
- **Tree-shake** unused exports — verify with bundle analyzer
- **Preload critical assets** (above-the-fold fonts, hero images)
- **Defer / async** non-blocking scripts
- **Compress assets** (gzip/brotli) and serve modern image formats (AVIF/WebP)
- **Cache aggressively** with content hashes in filenames
- **Avoid layout shift** — reserve space for async-loaded content

## Targets (Sensible Defaults)

- LCP: < 2.5s
- INP: < 200ms
- CLS: < 0.1
- TTFB: < 800ms
- Page load (cached): < 1s
- Page load (cold): < 3s

## Output Format

```
## Frontend Performance Report

### Core Web Vitals (Before → After)
| Metric | Page | Before | After |
|--------|------|--------|-------|

### Optimizations Applied
- [optimization] — [page] — [delta]

### Bundle Analysis
- Largest deps: [pkg] [size]
- Tree-shakable but bundled: [list]

### Recommended Next Steps
1. [item]
```

## Scope note
Frontend only. For backend/DB/cache or whole-system perf use `/team-performance`; for
concurrency/SLO load tests use `/team-test-load`.
