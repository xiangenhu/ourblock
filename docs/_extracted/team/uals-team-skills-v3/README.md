# UALS Team Skills + Runtime — v3.0

A Node.js (full-stack, CommonJS) system for building a **learning app**, in two layers:

- **Claude Code skills** — 38 `/team-*` slash commands, 9 shared reference docs, and a 56-agent
  manifest. Dev-time workflows you invoke (e.g. `/team-deploy`, `/team-bugfix`).
- **`@uals/skill-runtime`** — the Node backbone the skills assume exists: GCS-only persistence,
  the single LLM gateway (with variant-pool cache + per-user token accounting), three-tier roles,
  xAPI client, hash-based i18n, and two full features (contextual help + in-place assist, bug
  tracking/fixing).

The two layers share five enforced **invariants**: GCS-only storage · three-tier roles
(Admin/Educator/Learner) · single LLM gateway · variant-pool cache · learning-first UX.

> **Start here:** `SYSTEM_REFERENCE.md` is the comprehensive guide (architecture, flows, config,
> install, status, open decisions). `CRITIQUE.md` is the original evaluation. `CHANGELOG.md` traces
> v1 → v3.0.

## Layout
```
.
├── SYSTEM_REFERENCE.md   # comprehensive reference — read this first
├── README.md · CRITIQUE.md · CHANGELOG.md · MANIFEST.md
├── install.sh            # bash installer for the .claude/* files
├── skills/               # 38 team-*.md slash commands
│   └── _shared/          # 9 docs: 7 invariants/refs + CONTEXT_HELP.md & BUG_TRACKING_AND_FIXING.md
├── agents/               # AGENTS.md (56-agent manifest) + _TEMPLATE.md + 3 exemplars
└── runtime/              # @uals/skill-runtime: src/, public/contextual-help.js, scripts/, install.js, .env.example
```

## Install

**Skills (dev-time)** — into a project's `.claude/`:
```bash
node runtime/install.js /path/to/project     # or: ./install.sh /path/to/project
```
Commands pull shared docs via `@.claude/commands/_shared/…` (Claude Code resolves `@` from the project root).

**Runtime (run-time):**
```bash
cd runtime && npm install && cp .env.example .env   # then edit .env
```
```js
const { mount, errorHandler, bug } = require('@uals/skill-runtime');
bug.attachProcessHandlers();                              // earliest
mount(app, { help: true, bug: true, cost: true });        // /api/help/*, /api/assist, /server/telemetry/*, /api/admin/llm-usage
// ... your routes ...
app.use(errorHandler);                                    // last
```
Serve `public/contextual-help.js`, add `<script src="/contextual-help.js?v=1">` per page, set
`CFG.appSlug === APP_SLUG`, and populate `req.user = { id, role, email, classIds? }` before `mount()`.

## Commands (38)
SWE workflow: a11y, analytics, architect, backup, cache, clean, content, cost, database, debt,
deploy, deps, docs, dx, feature, flags, gcs, i18n, incident, load, monitor, performance, refactor,
review, security, test-e2e, test-integration, test-load, test-unit, ux, xapi, xgh-gateway.
Edtech/LLM: privacy, ai-safety, eval, efficacy, help, bugfix.

## Before production
See `SYSTEM_REFERENCE.md §11` (open decisions: caching default, cache store, gateway/auth shapes,
prices, ESM/CJS, subagents) and `§12` (what was/wasn't validated). Author the high-traffic subagents
listed in `agents/AGENTS.md`.
