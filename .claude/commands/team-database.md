---
description: DB review, query optimization & migration safety
argument-hint: [schema | queries | migration | indexes]
---

# Team Database

Data-layer review, access-pattern optimization, and migration support.

> **Project invariant (`@.claude/commands/_shared/storage-invariants.md`):** there is **no relational/NoSQL DB and
> no local storage** — **GCS is the one persistence layer**. Read "schema" as *folder/key layout*,
> "indexes" as *manifest/index objects you maintain*, and "migration" as *re-keying or
> re-shaping GCS objects*. For layout, versioning, and atomic writes defer to `/team-gcs`. Access
> is always role-scoped (`@.claude/commands/_shared/roles.md`).

## Target: $ARGUMENTS
Options: "schema" | "queries" | "migration" | "indexes"

## Workflow Phases

### Phase 1: Audit (Parallel)
- **Database Administrator**: Schema review, index coverage, query plans
- **Database Migration**: Migration safety (locking, backfill, rollback)

### Phase 2: Optimize (Sequential)
- **Database Administrator**: Apply index / query fixes

### Phase 3: Migration (Sequential, if applicable)
- **Database Migration**: Author + dry-run migration with rollback plan

## Generic Database Principles

- **Targeted queries with filters** — never scan whole tables or collections in application code
- **Indexes for filter columns** — verify with explain/profile, not assumption
- **N+1 query detection** — batch or join; avoid per-row queries in loops
- **Migrations are reversible** by default; irreversible changes need extra review
- **Long migrations run online** with chunking/throttling, not in a single transaction
- **Backfill data separately from schema change** when both are needed
- **Foreign keys / constraints enforced** at the DB level, not just application code

## Migration Safety Checklist

- [ ] Migration tested against production-sized data
- [ ] Lock duration measured and acceptable
- [ ] Backfill plan documented
- [ ] Rollback steps tested
- [ ] Monitoring / alerts in place during rollout
- [ ] Downstream consumers notified of schema change

## Output Format

```
## Database Report

### Slow Queries
| Query | Source | Latency | Fix |
|-------|--------|---------|-----|

### Index Recommendations
- [collection/table] — [fields] — [why]

### Migration Plan (if any)
- Step 1: [op] — [risk]
- Rollback: [steps]
```
