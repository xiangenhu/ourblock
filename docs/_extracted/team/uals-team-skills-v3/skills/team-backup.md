---
description: Backup, restore & disaster-recovery planning
argument-hint: [audit | backup-now | restore-test | drplan]
---

# Team Backup

Backup, restore, and disaster recovery planning.

## Target: $ARGUMENTS
Options: "audit" | "backup-now" | "restore-test" | "drplan"

## Workflow Phases

### Phase 1: Inventory (Sequential)
- **Backup Recovery**: List authoritative data stores and current backup state

### Phase 2: Execute (Sequential)
- **Backup Recovery**: Run targeted backup or restore-drill

### Phase 3: Verify (Sequential)
- **Backup Recovery**: Confirm integrity (checksums, sample restore)

## Generic Backup Principles

- **Distinguish authoritative from derivable** — only authoritative data needs explicit backup
- **3-2-1 rule** — 3 copies, 2 different media, 1 off-site
- **Automated and scheduled** — manual backups are not backups
- **A backup you haven't restored is not a backup** — drill restores regularly
- **Encrypt at rest** — even off-site copies
- **Backup access is audited** — restore credentials are sensitive
- **Document RPO and RTO** — recovery point and time objectives drive frequency and method

## What to Inventory

| Store | Contents | Authoritative? | Restore Priority |
|-------|----------|----------------|------------------|
| [primary db] | [contents] | Yes | P0 |
| [event log / audit] | [contents] | Yes | P0 |
| [object storage — source files] | [contents] | Yes | P1 |
| [object storage — derivable] | [contents] | No | P3 |
| [config / secrets] | [contents] | Yes | P1 |

## Output Format

```
## Backup Report

### Coverage
| Store | Last Backup | RPO Met? | Integrity |
|-------|-------------|----------|-----------|

### Gaps
- [store] — [issue]

### Restore Drill Results
- [store] — [time to restore] — [data loss]

### DR Plan Updates
1. [change]
```

## Project invariants
- Authoritative data is GCS; erasure/restore must reach every version, cache, backup: `@.claude/commands/_shared/storage-invariants.md`
