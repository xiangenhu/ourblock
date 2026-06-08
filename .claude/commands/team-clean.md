---
description: Sweep dead code, smells & style drift
argument-hint: [full | <dir> | current branch]
---

# Team Clean

Sweep the codebase for dead code, smells, and style drift in one pass.

## Scope: $ARGUMENTS
Options: full | directory | "current branch"

## Workflow Phases

### Phase 1: Detection (Parallel)
- **Dead Code Eliminator**: Unused exports, unreachable code, orphaned files
- **Code Smell Detector**: Long methods, god objects, primitive obsession
- **Code Standards Specialist**: Style/DRY violations, inconsistent patterns

### Phase 2: Verification (Sequential)
- **Static Code Analyzer**: Confirm dead-code candidates with reachability analysis

### Phase 3: Cleanup (Sequential)
- **Refactoring Engine**: Apply safe removals and renames

## Generic Watch List

- **Backwards-compat shims** still around after the feature they supported is removed
- **Translation/i18n keys** with no remaining references
- **Duplicate utilities** that should be consolidated into a shared module
- **Old code paths** replaced by a new system but never removed
- **Commented-out blocks** retained "just in case"
- **TODOs older than 6 months** with no linked tracking issue

## Output Format

```
## Cleanup Report

### Removed
- Dead code: [count] items ([LOC])
- Unused exports: [count]
- Orphaned files: [list]

### Smells Fixed
| Smell | Count | Files |
|-------|-------|-------|

### Style Conformance
- Violations before: [N]
- Violations after: [N]

### Skipped (Needs Human Review)
- [item] — [reason]
```

## Shared references
Code-quality signals and the four-command disambiguation table live in one place — pull them in:
`@.claude/commands/_shared/code-quality.md`
