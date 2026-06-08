---
description: Audit/upgrade dependencies + env-config parity
argument-hint: [audit | upgrade-safe | upgrade-major | env]
---

# Team Dependencies

Audit, upgrade, and align dependencies + environment configuration.

## Target: $ARGUMENTS
Options: "audit" | "upgrade-safe" | "upgrade-major" | "env"

## Workflow Phases

### Phase 1: Audit (Parallel)
- **Dependency Manager**: Vulnerabilities, outdated packages, license check
- **Environment Configuration Manager**: Env var parity across environments, missing vars

### Phase 2: Plan (Sequential)
- **Dependency Manager**: Group upgrades by risk (patch / minor / major)

### Phase 3: Apply (Sequential)
- **Dependency Manager**: Bump versions; run tests after each group
- **Environment Configuration Manager**: Reconcile env config

## Generic Dependency Principles

- **Pin versions in lockfiles** — reproducible builds depend on it
- **Audit on every CI run** — vulnerabilities aren't worth catching weekly
- **Upgrade in small batches** — large upgrade PRs hide regressions
- **Patch and minor upgrades** can usually be batched and merged together
- **Major upgrades** get their own PR with a manual review of breaking changes
- **License compliance** checked before adding new deps, not after
- **Direct dependencies only** in package manifests — let transitive deps resolve via lockfile

## Env Var Discipline

- **No secrets in source control** — use a secret manager
- **`.env.example`** lists every required var with description (committed)
- **Real `.env`** is gitignored
- **Startup fails loudly** when required vars are missing
- **Env parity** across dev / staging / prod is documented; differences are intentional

## Output Format

```
## Dependency Report

### Vulnerabilities
| Package | Severity | Fixed In | Patch Available? |
|---------|----------|----------|------------------|

### Outdated (Safe Upgrades)
- [pkg] [current] → [latest patch]

### Outdated (Major — Needs Plan)
- [pkg] [current] → [latest] — [breaking changes]

### Env Config Drift
- [var] — [missing in env / mismatched]

### Action Items
1. [item]
```
