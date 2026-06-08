---
description: Architecture-first design for a new system/component
argument-hint: <system or component>
---

# Team Architect

Design a new system or major component with an architecture-first workflow.

## Target: $ARGUMENTS

## Workflow Phases

### Phase 1: Discovery (Parallel)
Launch simultaneously:
- **Architect**: System design, patterns, integration points, scalability
- **Data Analyst**: Analytics/observability requirements
- **Security Specialist**: Threat model, auth/authz surface
- **UI/UX Specialist**: User-facing surface area (if applicable)

### Phase 2: Synthesis (Sequential)
- **Architect**: Consolidates findings into an Architecture Decision Record (ADR)

### Phase 3: Validation (Parallel)
- **Code Standards Specialist**: DRY/SOLID conformance check
- **Dependency Manager**: Required deps and licensing
- **DevOps Engineer**: Infrastructure feasibility

## General Principles

- Prefer ONE implementation of each capability; avoid parallel forks that drift
- Make integration points explicit (interfaces, contracts, schemas)
- Identify data ownership and source-of-truth boundaries up front
- Choose boring technology unless there's a reason not to
- Design for observability and rollback before scale

## Output Format

```
## Architecture Decision Record: [Target]

### Context
[Why this design is needed]

### Decision
[The architectural choice]

### Components
- [component]: [responsibility]

### Integration Points
- [system]: [interface]

### Data Flow
[Sources of truth, write paths, read paths]

### Trade-offs
- Pros: [list]
- Cons: [list]

### Open Questions
1. [question]
```

## Project invariants
- Designs must honor: `@.claude/commands/_shared/roles.md` (3-tier RBAC) and `@.claude/commands/_shared/storage-invariants.md` (GCS-only, hash-i18n-in-GCS).

- Learning-first UX (entry jargon, focus over density, in-place LLM help, tabs/modals): `@.claude/commands/_shared/learning-ux.md`
