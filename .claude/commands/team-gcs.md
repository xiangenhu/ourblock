---
description: Use Google Cloud Storage as primary persistence
argument-hint: [design <data-type> | audit | migrate-from-localstorage | version-strategy]
---

# Team GCS

Use Google Cloud Storage as the primary persistence layer (with strict localStorage limits).

## Target: $ARGUMENTS
Options: "design <data-type>" | "audit" | "migrate-from-localstorage" | "version-strategy"

## Workflow Phases

### Phase 1: Audit / Design (Parallel)
- **Database Administrator**: Treat GCS as a data store; review folder layout and access patterns
- **Architect**: Storage strategy, versioning, atomic write patterns
- **Security Specialist**: IAM, bucket policies, signed URLs

### Phase 2: Implement (Sequential)
- **Fullstack Developer**: Wire reads/writes through a shared GCS client module

### Phase 3: Validate (Sequential)
- **Backup Recovery**: Verify versioning and recovery
- **QA Testing**: Test read-after-write consistency and concurrent-write behavior

## Storage Discipline

### What lives in GCS (authoritative)
- User-generated content (uploads, recordings)
- Generated artifacts (cached LLM output, exports, reports)
- Configuration files / framework definitions
- Versioned application content (curricula, lessons, items)
- Backups and exports

### localStorage is NEVER a data store
GCS is the one and only persistence layer (see `@.claude/commands/_shared/storage-invariants.md`). The only
permitted `localStorage` use is **transient UI-only state** (open panels, last route, a form
draft the user wouldn't mind losing). Everything else is a violation:
- ❌ Authentication tokens (use httpOnly cookies / the OAuth gateway)
- ❌ Any user-owned data (lives in GCS)
- ❌ Translation/language files (live in GCS — see `/team-i18n`)
- ❌ Anything another device or role must see, or that you'd be sad to lose on reset

### What lives nowhere persistent
- Secrets (use Secret Manager)
- Identity tokens (use HTTP-only cookies / OAuth gateway)

## Standard Folder Layout (role-scoped — see `@.claude/commands/_shared/roles.md`)

```
{bucket}/
├── users/{userId}/...               # self (Learner) + Educators of their classes + Admin
├── classes/{classId}/...            # class members + owning Educator + Admin
├── frameworks/
│   ├── shared/                      # global catalogs — R: all, RW: Admin
│   └── owner/{ownerId}/...          # owning Educator + Admin
├── i18n/registry.json               # hash → {en, zh, …} translation registry (never in repo)
├── config/...                       # Admin only
├── cache/
│   ├── {scope}-{id}/{type}/{hash}/  # scoped cache
│   │   └── {version}/content.json
│   └── GENERAL_USE/{type}/{hash}/
└── uploads/{userId}/{yyyy-mm-dd}/   # uploader + their Educators + Admin
```

Access to every prefix is decided by `(role, membership)`, enforced server-side via IAM /
signed URLs — never by client-side path knowledge.

## Versioning

- **Enable Object Versioning** on buckets holding authoritative data
- **Application-level versioning** (numbered folders `1/`, `2/`, ...) for content with explicit version semantics (e.g., teacher edits to generated content)
- **Rotate when limit reached** — delete oldest, keep N most recent (e.g., `CONTENT_CACHE_VERSIONS=4`)
- **Lifecycle rules** — auto-delete derivable cache versions after 90 days; preserve authoritative indefinitely

## Atomic Writes

- Write to a temp object, then copy to final location
- Use `if-generation-match: 0` for "create if not exists"
- Use `if-generation-match: N` for optimistic concurrency on updates

## Required Configuration

| Env Var | Purpose | Notes |
|---------|---------|-------|
| `GCP_PROJECT_ID` | GCP project | required |
| `GCS_BUCKET_NAME` | Default bucket | required |
| `GCS_KEY_FILE` | Service account JSON path | **local dev only** — Cloud Run uses ADC |

## Cloud Run Notes

- Mount nothing — GCS is your filesystem
- Service account for the Cloud Run service gets `roles/storage.objectAdmin` on its bucket(s)
- No `GCS_KEY_FILE` env var in production — ADC handles auth

## Output Format

```
## GCS Storage Report

### Folder Layout Audit
| Path Pattern | Authoritative? | Versioning | Lifecycle |
|--------------|----------------|------------|-----------|

### localStorage Violations
- [file:line] — [key] — should be in GCS because [reason]

### Migration Plan (if applicable)
1. [data] — [from] → [GCS path] — [strategy]

### Cost / Capacity
- Bucket size: [GB]
- Monthly read ops: [N]
- Estimated $: [amount]
```

## Shared references
Cache-key invariants are canonical here — do not restate them, reference them:
`@.claude/commands/_shared/cache-invariants.md`
