# UALS Team — Subagent Manifest

> **Why this file exists.** Every `/team-*` command delegates to named subagents
> (e.g. *Architect*, *Security Specialist*). **None were shipped in the original bundle.**
> Without matching files in `.claude/agents/`, Claude Code cannot route to a real worker —
> it silently role-plays the persona in the main context, losing the isolation, scoped tools,
> and separate context window that make the team pattern worthwhile.

> **Action required:** author one `.claude/agents/<slug>.md` per row below (or migrate the
> commands to Skills with `context: fork`, which runs a skill in isolation as a subagent
> without a separate agent file). Rows marked **+** are new agents for the added commands.

> **Routing tip (current best practice):** job-shaped slugs (`code-reviewer`, `dba`) route more
> reliably than generic role names (`frontend-engineer`). The slugs below follow that pattern.

## Required agents (56 total)

| Persona (as referenced) | Suggested `.claude/agents/` slug | Role (1-liner) | Used by |
|---|---|---|---|
| Architect | `architect` | System design, ADRs, integration & data-ownership boundaries | /team-architect, /team-debt, /team-feature, /team-gcs, /team-refactor, /team-security, /team-xapi, /team-xgh-gateway |
| Fullstack Developer | `fullstack-developer` | Implements features end-to-end through shared modules | /team-feature, /team-gcs, /team-i18n, /team-performance, /team-privacy, /team-security, /team-xapi, /team-xgh-gateway |
| QA Testing | `qa-testing` | Runs suites, verifies coverage deltas, isolates flaky tests | /team-gcs, /team-i18n, /team-test-e2e, /team-test-integration, /team-test-unit, /team-xapi, /team-xgh-gateway |
| UI/UX Specialist | `ui-ux-specialist` | Component-level usability, applies changes via the design system | /team-a11y, /team-architect, /team-feature, /team-ux |
| UX Consistency Specialist | `ux-consistency-specialist` | Detects style/token drift and one-off components | /team-a11y, /team-ux |
| User Journey Specialist | `user-journey-specialist` | Maps end-to-end flows; finds friction and drop-off | /team-test-e2e, /team-ux |
| Cross Platform Specialist | `cross-platform-specialist` | Mobile/tablet/desktop parity across browsers | /team-i18n |
| Accessibility Compliance Checker | `a11y-checker` | WCAG 2.1 AA/AAA scan and re-scan | /team-a11y, /team-ai-safety, /team-feature, /team-i18n |
| Data Analyst | `data-analyst` | Metric definitions, targeted queries, validation vs raw events | /team-analytics, /team-architect, /team-cost, /team-efficacy, /team-eval, /team-feature, /team-performance, /team-xapi |
| Static Code Analyzer | `static-analyzer` | Complexity, maintainability, duplication metrics | /team-clean, /team-debt, /team-feature, /team-refactor, /team-review, /team-security |
| Code Smell Detector | `smell-detector` | God objects, feature envy, primitive obsession, long methods | /team-clean, /team-debt, /team-feature, /team-refactor, /team-review |
| Code Standards Specialist | `standards-specialist` | DRY/SOLID and style conformance | /team-architect, /team-clean, /team-i18n, /team-refactor, /team-review |
| Dead Code Eliminator | `dead-code-eliminator` | Unused exports, unreachable branches, orphaned files | /team-clean, /team-debt, /team-review |
| Refactoring Engine | `refactoring-engine` | Sequences and applies safe transformations/codemods | /team-clean, /team-refactor |
| Architecture Refactoring Specialist | `arch-refactor-specialist` | Structural/boundary refactors | /team-performance, /team-refactor |
| Component Modernization Specialist | `component-modernizer` | Upgrades dated UI/code patterns | /team-refactor |
| Code Review Automation | `code-reviewer` | Synthesizes findings into a prioritized review | /team-feature, /team-refactor, /team-review |
| Technical Debt Tracker | `debt-tracker` | Maintains debt register; burn-down plans | /team-debt, /team-refactor, /team-review |
| Security Specialist | `security-specialist` | Threat model, exploitability, compliance, remediation | /team-architect, /team-gcs, /team-privacy, /team-security, /team-xgh-gateway |
| Security Vulnerability Scanner | `vuln-scanner` | OWASP/injection/authz scan with CWE refs | /team-feature, /team-review, /team-security |
| Dependency Manager | `dependency-manager` | CVEs, outdated packages, licenses, upgrade batching | /team-architect, /team-deps, /team-security |
| Environment Configuration Manager | `env-config-manager` | Env-var parity and required-var enforcement | /team-deps |
| DevOps Engineer | `devops-engineer` | Env/secret/infra readiness; smoke + health checks | /team-architect, /team-deploy, /team-feature |
| Docker Container Orchestrator | `docker-orchestrator` | Builds/tags reproducible container images | /team-deploy |
| CI/CD Pipeline Manager | `cicd-manager` | Pipeline gates, artifact push, rollout | /team-deploy, /team-feature |
| Database Administrator | `dba` | Schema, indexes, query plans, N+1 detection | /team-database, /team-gcs, /team-privacy |
| Database Migration | `db-migration` | Reversible, online, throttled migrations + rollback | /team-database |
| Backup Recovery | `backup-recovery` | Inventory, backup/restore drills, integrity, RPO/RTO | /team-backup, /team-gcs |
| Cache Invalidation Coordinator | `cache-coordinator` | Hit/miss analysis and key-consistency invariants | /team-cache |
| Code Optimization Specialist | `code-optimizer` | Algorithmic/runtime/cache tuning | /team-cache, /team-cost, /team-load, /team-performance |
| Loading Performance Specialist | `loading-perf-specialist` | Core Web Vitals; font/image/CSS optimization | /team-load, /team-performance |
| Performance Metrics Collector | `perf-metrics-collector` | Counters/histograms; latency/throughput capture | /team-analytics, /team-load, /team-monitor, /team-performance, /team-review, /team-test-load |
| Performance Test Runner | `perf-test-runner` | Benchmark scenarios and SLO targets | /team-performance, /team-test-load |
| Load Test Simulator | `load-simulator` | Drives concurrency (k6/Artillery/Locust) | /team-performance, /team-test-load |
| APM Integration | `apm-integration` | Trace coverage, spans, attributes | /team-analytics, /team-monitor, /team-xapi |
| Uptime Monitor | `uptime-monitor` | External probes, alert thresholds, on-call routing | /team-monitor |
| Health Check Coordinator | `health-check-coordinator` | Liveness vs readiness endpoints + deps | /team-monitor |
| Error Tracking | `error-tracking` | Error spikes, root-cause hypotheses, postmortems | /team-incident |
| Log Aggregation | `log-aggregation` | Correlated log queries around incident windows | /team-incident |
| Unit Test Generator | `unit-test-generator` | Behavior-focused unit tests at module boundaries | /team-feature, /team-refactor, /team-test-integration, /team-test-unit |
| Integration Test Coordinator | `integration-test-coordinator` | Fixtures and cross-module scaffolding | /team-feature, /team-test-integration |
| Integration Testing Specialist | `integration-test-specialist` | Maps contracts/seams across boundaries | /team-test-integration |
| E2E Test Orchestrator | `e2e-orchestrator` | Journey scripts with stable selectors | /team-feature, /team-test-e2e |
| Internationalization Expert | `i18n-expert` | Hash compliance, untranslated strings, locale handling | /team-i18n |
| Documentation Specialist | `docs-specialist` | Guides, staleness signals, link/sample checks | /team-docs, /team-feature |
| Code Documentation Generator | `docstring-generator` | Docstrings/API reference from code | /team-docs, /team-feature, /team-test-unit |
| Demo Documentation Specialist | `demo-docs-specialist` | Runnable examples and demos | /team-docs, /team-feature |
| Developer Experience Specialist | `dx-specialist` | Onboarding friction, setup scripts, defaults | /team-dx |
| Development Workflow Specialist | `dev-workflow-specialist` | Inner-loop speed, watchers, IDE/lint config | /team-dx |
| Feature Flag Controller | `flag-controller` | Flag lifecycle, kill switches, stale-flag cleanup | /team-efficacy, /team-flags |
| Content Generation | `content-generation` | Routes generation through the unified gateway; schema-validated | /team-ai-safety, /team-content |
| Privacy Compliance Officer **+** | `privacy-officer` | Data map, lawful basis, FERPA/COPPA/GDPR-K/PIPL gaps | /team-privacy |
| Safety Red-Teamer **+** | `safety-red-teamer` | Adversarial probing; jailbreak/persona-break/age-misfit | /team-ai-safety |
| Learning Scientist **+** | `learning-scientist` | Pedagogical rubric, study design, interpretation | /team-ai-safety, /team-efficacy, /team-eval |
| Eval Engineer **+** | `eval-engineer` | Golden sets, scorers, regression gates, drift logs | /team-eval |
| FinOps Analyst **+** | `finops-analyst` | Spend attribution, budgets, cost SLOs | /team-cost |
