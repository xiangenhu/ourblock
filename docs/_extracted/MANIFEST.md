# v3.0 Release Manifest

Generated 2026-05-31T02:28Z. Counts and integrity verified at release (see CHANGELOG v3.0).

## Contents
- Commands: 38
- Shared docs: 9
- Agent files: 5 (manifest + template + exemplars; full roster = 56 in AGENTS.md)
- Runtime JS modules: 21
- Total files: 82

## Enforced invariants → canonical doc → runtime enforcer
| Invariant | Doc (skills/_shared/) | Runtime |
|---|---|---|
| GCS-only persistence | storage-invariants.md | runtime/src/store/gcs.js |
| Three-tier roles | roles.md | runtime/src/roles/authz.js |
| Single LLM gateway | llm-gateway.md | runtime/src/llm/gateway.js |
| Variant-pool cache | cache-invariants.md | runtime/src/llm/cache.js |
| Learning-first UX | learning-ux.md | runtime/src/help/assist.js (P3) |

## Runtime endpoints (when mounted)
- GET  /api/config/help-hover
- POST /api/help/ask
- POST /api/assist                      (in-place work-surface help; learner auth)
- GET  /api/admin/help-analytics        (Admin only)
- GET  /api/admin/llm-usage             (Admin only)
- POST /server/telemetry/bug-report
- GET  /server/telemetry/bug-reports    (Admin only)

## Full file list
```
CHANGELOG.md
CRITIQUE.md
MANIFEST.md
README.md
SYSTEM_REFERENCE.md
agents/AGENTS.md
agents/_TEMPLATE.md
agents/architect.md
agents/code-reviewer.md
agents/privacy-officer.md
install.sh
runtime/.env.example
runtime/README.md
runtime/install.js
runtime/package.json
runtime/public/contextual-help.js
runtime/scripts/bug-triage.js
runtime/src/bug/fetch.js
runtime/src/bug/fixlog.js
runtime/src/bug/reporter.js
runtime/src/bug/routes.js
runtime/src/config.js
runtime/src/help/assist.js
runtime/src/help/grounding.js
runtime/src/help/routes.js
runtime/src/i18n/hash.js
runtime/src/index.js
runtime/src/llm/accounting.js
runtime/src/llm/cache.js
runtime/src/llm/gateway.js
runtime/src/llm/routes.js
runtime/src/roles/authz.js
runtime/src/store/gcs.js
runtime/src/util/hash.js
runtime/src/xapi/client.js
skills/_shared/BUG_TRACKING_AND_FIXING.md
skills/_shared/CONTEXT_HELP.md
skills/_shared/cache-invariants.md
skills/_shared/code-quality.md
skills/_shared/learning-ux.md
skills/_shared/llm-gateway.md
skills/_shared/roles.md
skills/_shared/security-baseline.md
skills/_shared/storage-invariants.md
skills/team-a11y.md
skills/team-ai-safety.md
skills/team-analytics.md
skills/team-architect.md
skills/team-backup.md
skills/team-bugfix.md
skills/team-cache.md
skills/team-clean.md
skills/team-content.md
skills/team-cost.md
skills/team-database.md
skills/team-debt.md
skills/team-deploy.md
skills/team-deps.md
skills/team-docs.md
skills/team-dx.md
skills/team-efficacy.md
skills/team-eval.md
skills/team-feature.md
skills/team-flags.md
skills/team-gcs.md
skills/team-help.md
skills/team-i18n.md
skills/team-incident.md
skills/team-load.md
skills/team-monitor.md
skills/team-performance.md
skills/team-privacy.md
skills/team-refactor.md
skills/team-review.md
skills/team-security.md
skills/team-test-e2e.md
skills/team-test-integration.md
skills/team-test-load.md
skills/team-test-unit.md
skills/team-ux.md
skills/team-xapi.md
skills/team-xgh-gateway.md
```
