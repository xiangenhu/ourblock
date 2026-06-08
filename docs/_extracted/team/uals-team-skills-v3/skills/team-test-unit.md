---
description: Generate & validate unit tests
argument-hint: [<file> | <module> | uncovered functions]
---

# Team Test Unit

Generate and validate unit tests for target code.

## Target: $ARGUMENTS
Options: file path | module | "uncovered functions"

## Workflow Phases

### Phase 1: Coverage Analysis (Sequential)
- **QA Testing**: Identify uncovered branches, functions, edge cases

### Phase 2: Generation (Parallel)
- **Unit Test Generator**: Create tests per module
- **Code Documentation Generator**: Update docstrings on tested APIs

### Phase 3: Verification (Sequential)
- **QA Testing**: Run the test suite; verify pass/fail and coverage delta

## Generic Test Conventions

- **Detect the test runner from the project** (Jest, Vitest, Mocha, Pytest, etc.) — don't assume one
- **Mock external dependencies** at module boundaries: network, filesystem, time, randomness, third-party SDKs
- **Mock authentication context** rather than simulating real cookies/tokens in unit tests
- **One assertion concept per test**; descriptive names that read as specifications
- **Avoid testing implementation details** — test observable behavior
- **Snapshot tests sparingly** — they rot and become rubber stamps

## Output Format

```
## Unit Test Report

### Tests Created
- [file] — [N tests, M assertions]

### Coverage Delta
- Statements: [before]% → [after]%
- Branches:   [before]% → [after]%
- Functions:  [before]% → [after]%

### Failures
- [test name] — [reason]

### Untestable (Needs Refactor)
- [function] — [why]
```
