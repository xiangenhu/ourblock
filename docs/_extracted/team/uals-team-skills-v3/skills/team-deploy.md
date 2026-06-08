---
description: Build, package & deploy the application
argument-hint: [dev | staging | production | rollback]
---

# Team Deploy

Build, package, and deploy the application.

## Target: $ARGUMENTS
Options: "dev" | "staging" | "production" | "rollback"

## Workflow Phases

### Phase 1: Pre-Flight (Parallel)
- **DevOps Engineer**: Verify env vars, secrets, infra access
- **Docker Container Orchestrator**: Confirm container image builds cleanly
- **CI/CD Pipeline Manager**: Verify pipeline green; no blockers

### Phase 2: Build (Sequential)
- **Docker Container Orchestrator**: Build and tag image (or equivalent artifact)

### Phase 3: Deploy (Sequential)
- **CI/CD Pipeline Manager**: Push artifact and roll out to target environment
- **DevOps Engineer**: Smoke test post-deploy

### Phase 4: Verify (Sequential)
- **DevOps Engineer**: Run health checks against deployed URL

## Generic Deploy Checklist

- [ ] Lint and tests pass locally and in CI
- [ ] Build artifact reproducible from clean checkout
- [ ] Required env vars and secrets present in target environment
- [ ] Secrets never committed; loaded from a secret manager
- [ ] Health/readiness endpoints respond correctly
- [ ] Previous version remains running until new version is healthy
- [ ] Rollback procedure documented and tested
- [ ] Monitoring and alerts armed for the new version
- [ ] Deploy logged with version, commit SHA, deployer

## Rollback

- Identify the previous known-good revision
- Shift traffic back to it (instant rollback preferred over rebuild)
- Investigate before rolling forward again

## Output Format

```
## Deploy Report

### Pre-Flight
- Lint: [pass/fail]
- Tests: [pass/fail]
- Health (local): [pass/fail]

### Build
- Artifact: [tag/version]
- Size: [MB]
- Build time: [s]

### Deploy
- Target: [env]
- Revision: [id]
- Traffic: [%]

### Smoke Tests
- [test] — [result]

### Rollback Plan
- Previous revision: [id]
```
