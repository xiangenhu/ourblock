---
description: Full feature build with a coordinated team
argument-hint: <feature description>
---

# Team Feature Development

Execute full feature development with a coordinated team workflow.

## Feature: $ARGUMENTS

## Workflow Phases

### Phase 1: Planning (Parallel)
Launch simultaneously:
- **Architect**: System design, patterns, integration points
- **UI/UX Specialist**: Interface design, user flows, accessibility
- **Data Analyst**: Analytics/tracking requirements

### Phase 2: Implementation (Sequential)
- **Fullstack Developer**: Core implementation based on planning phase outputs

### Phase 3: Quality Gates (Parallel)
Launch simultaneously:
- **Code Review Automation**: Review implementation
- **Static Code Analyzer**: Quality metrics
- **Code Smell Detector**: Anti-patterns
- **Security Vulnerability Scanner**: Security issues

### Phase 4: Testing (Parallel)
Launch simultaneously:
- **Unit Test Generator**: Create unit tests
- **Integration Test Coordinator**: Integration tests
- **E2E Test Orchestrator**: End-to-end tests
- **Accessibility Compliance Checker**: WCAG compliance

### Phase 5: Documentation (Parallel)
Launch simultaneously:
- **Documentation Specialist**: Technical documentation
- **Code Documentation Generator**: API docs / docstrings
- **Demo Documentation Specialist**: Examples and demos

### Phase 6: Deployment (Sequential)
- **DevOps Engineer**: Environment preparation
- **CI/CD Pipeline Manager**: Pipeline configuration

## Execution Instructions

1. **Planning Phase** — Launch 3 parallel agents; consolidate design decisions
2. **Implementation Phase** — Pass consolidated plan to Fullstack Developer
3. **Quality Gates Phase** — Launch 4 parallel quality agents; iterate on critical issues
4. **Testing Phase** — Launch 4 parallel testing agents; generate test files and coverage
5. **Documentation Phase** — Launch 3 parallel documentation agents
6. **Deployment Phase** — Prepare deployment configuration

## Output Format

```
## Feature Development Report: [Feature Name]

### Planning Summary
- Architecture: [summary]
- UI/UX Design: [summary]
- Analytics: [tracking requirements]

### Implementation
- Files created: [list]
- Files modified: [list]
- Key changes: [summary]

### Quality Results
- Code quality: [metrics]
- Security: [status]
- Code smells: [count/status]

### Testing
- Unit tests: [count] ([coverage]%)
- Integration tests: [count]
- E2E tests: [count]
- Accessibility: [WCAG level]

### Documentation
- Updated: [list of docs]
- Created: [list of new docs]

### Deployment
- Status: [ready/blocked]
- Notes: [any deployment considerations]

### Next Steps
1. [action item]
2. [action item]
```

## Shared references
Security baseline gate: `@.claude/commands/_shared/security-baseline.md` · Minor/student-data handling: `/team-privacy`

## Project invariants
- Every feature spans Admin/Educator/Learner: `@.claude/commands/_shared/roles.md` · GCS-only persistence: `@.claude/commands/_shared/storage-invariants.md`

- Learning-first UX (entry jargon, focus over density, in-place LLM help, tabs/modals): `@.claude/commands/_shared/learning-ux.md`
