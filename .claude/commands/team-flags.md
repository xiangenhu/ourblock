---
description: Design, ship & clean up feature flags
argument-hint: [add <flag> | audit | cleanup]
---

# Team Flags

Design, ship, and clean up feature flags.

## Target: $ARGUMENTS
Options: "add <flag-name>" | "audit" | "cleanup"

## Workflow Phases

### Phase 1: Design / Inventory
- **Feature Flag Controller**: List active flags, age, default state, owner

### Phase 2: Implement (if "add")
- **Feature Flag Controller**: Wire flag, define rollout strategy, kill switch

### Phase 3: Cleanup (if "audit" / "cleanup")
- **Feature Flag Controller**: Identify stale flags (fully rolled out or abandoned) and remove

## Generic Flag Conventions

- **Boolean by default** — multi-variant only with explicit need
- **Always have a kill switch** — instant rollback without redeploy
- **Time-box flags** — every flag has an expected removal date
- **Default OFF in production** until validated
- **Never gate security fixes** — those ship unconditionally
- **One owner per flag** — orphaned flags rot
- **Flag state visible in logs / traces** — failures with flags on/off must be diagnosable

## Stale Flag Smells

- ✓ Flag has been ON 100% for > 30 days → remove flag, keep code
- ✓ Flag has been OFF 100% for > 30 days → remove flag, remove code
- ✓ No owner listed → reassign or remove
- ✓ Referenced in only one place → likely a temporary that became permanent

## Output Format

```
## Feature Flag Report

### Active Flags
| Flag | Default | Rollout | Owner | Age | Status |
|------|---------|---------|-------|-----|--------|

### Recommended Cleanup
- [flag] — [why] — [keep ON | keep OFF | remove]

### New Flag (if added)
- Name: [flag]
- Type: [boolean / multi-variant]
- Default: [value]
- Kill switch: [yes/no]
- Removal date: [date]
```
