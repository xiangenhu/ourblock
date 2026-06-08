# UALS Team Skills + Runtime — System Reference

**Version:** v3.0 · **Status:** engineering reference for installation and review · **Scope:** the
`team-*` Claude Code skills, their shared invariants and subagents, and the `@uals/skill-runtime`
Node.js backbone that implements the features they describe.

> This document is a reference for engineers and reviewers. It marks each capability as
> **Implemented**, **Specified** (drop-in source exists, wiring is yours), **Stub** (scaffold +
> manifest, you author the rest), or **Decision** (a knob you set before production). Claims about
> Claude Code behaviour are dated and sourced in the appendix.

---

## 1. Executive summary

The system has two layers that share one set of invariants:

- **Layer A — Claude Code skills.** 38 `/team-*` slash commands plus 9 shared reference docs and a
  56-agent manifest. Each command is a phased workflow (audit → fix → verify) that a developer
  invokes in Claude Code. They encode *how the team works*; they do not run in the app.
- **Layer B — `@uals/skill-runtime`.** A CommonJS Node package that provides the shared primitives
  the skills assume exist: a GCS persistence layer, the single LLM gateway, three-tier authorization,
  an xAPI client, hash-based i18n, and two full features (contextual help, bug tracking/fixing). This
  *runs in the app*.

The spine connecting them is a small set of **project invariants** — GCS-only storage, three-tier
roles, a single LLM gateway, hash-based i18n, and a variant-pool cache — each stated once (in
`_shared/`) and enforced in code (in the runtime). The design goal throughout: state a rule in one
place, reference it everywhere, never let copies drift.

**What is production-ready vs not.** The runtime's logic (gateway, cache, accounting, authz, xAPI
guard, hashing, bug-statement shape) is implemented and unit-tested. The two pieces that are *not*
turnkey are the 56 subagents (manifest + 3 exemplars shipped; you author the rest) and the few
explicit **Decisions** in §11 (caching default, LRS-vs-GCS for the cache, your gateway/auth shapes).

---

## 2. The two layers at a glance

```
┌──────────────────────── Layer A: Claude Code skills (dev-time) ────────────────────────┐
│  .claude/commands/team-*.md   ── 38 phased workflows, user-invoked (/team-…)            │
│  .claude/commands/_shared/*   ── 8 canonical docs, pulled via @ (invariants + 2 specs)  │
│  .claude/agents/*             ── 56-agent manifest + template + 3 exemplars             │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                      │ describe / audit / scaffold
                                      ▼
┌──────────────────────── Layer B: @uals/skill-runtime (run-time) ───────────────────────┐
│  config · store/gcs · llm/{gateway,cache,accounting,routes} · roles · xapi · i18n       │
│  help/{routes,grounding} + public/contextual-help.js · bug/{reporter,routes,fetch,…}    │
│  install.js · scripts/bug-triage.js · package.json · .env.example                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Project invariants (the spine)

These are stated once in `_shared/` and referenced by every command they govern (via
`@.claude/commands/_shared/<file>`, which Claude Code resolves from the project root). The runtime
enforces them in code.

| Invariant | Canonical doc | Enforced in runtime by | One-line rule |
|---|---|---|---|
| **GCS-only persistence** | `storage-invariants.md` | `store/gcs.js` | GCS is the only data store; `localStorage` never holds data; i18n language files live in GCS. |
| **Three-tier roles** | `roles.md` | `roles/authz.js` | Admin · Educator · Learner; deny-by-default; role is necessary but not sufficient (resource-level membership). |
| **Single LLM gateway** | `llm-gateway.md` | `llm/gateway.js` | Every model call goes through one `callLLM()`; no feature imports a provider. |
| **Variant-pool cache** | `cache-invariants.md` | `llm/cache.js` | Up to `CACHE_MAX` response variants per request; serve cached, background-fill; language in the key. |
| **Cache-key discipline** | `cache-invariants.md` | `llm/cache.js`, `help/routes.js` | Identical logical inputs → identical key; language is part of the key by construction. |
| **Code-quality signals** | `code-quality.md` | — (dev-time) | Shared smell/debt/dead-code lists + the four-command disambiguation. |
| **Security baseline** | `security-baseline.md` | `roles/authz.js`, route guards | Quick gate referenced by security/feature/help/bugfix. |
| **Learning-first UX** | `learning-ux.md` | `help/assist.js` (P3); rest dev-time | No entry jargon; ease over density; in-place LLM help (scaffold); tabs/modals for focus. |

### 3.1 Why each invariant exists (rationale, not just rule)

- **GCS-only.** One answer to "where does this persist?" eliminates an entire class of bugs and makes
  erasure tractable (one store to purge). On Cloud Run the local filesystem is per-instance and lost
  on restart, so anything stateful *must* be GCS — this is why the bug fix-log was moved off a local
  file (see §6.3).
- **Three-tier roles.** Education data is special-category data about (often) minors. The sharp rule
  is that an Educator reaches a Learner only through *class membership*, not the Educator role alone —
  a role check is necessary but not sufficient, and it must be enforced server-side.
- **Single gateway.** It is the only place where language consistency, token accounting, caching, and
  provider choice can be guaranteed for *all* calls at once. If features call providers directly, each
  of those four guarantees becomes a per-feature hope.
- **Variant-pool cache.** Bounds LLM cost to ≤ `CACHE_MAX` generations per unique request while giving
  phrasing variety (valuable for instructional text) and removing latency on warm requests.
- **Learning-first UX.** Attention is the scarce resource. The interface minimizes extraneous cognitive
  load (jargon, density, context-switching) so working memory is spent on understanding, and puts LLM
  help where the learner is already working (scaffolding, not solving).

---

## 4. Layer A — Claude Code skills

### 4.1 Commands, skills, and subagents (and a current-Claude-Code nuance)

- A **slash command** is `.claude/commands/x.md`; user-invoked; `$ARGUMENTS` is the full trailing
  string. This is what the 38 files are.
- A **skill** is `.claude/skills/x/SKILL.md`; model-*invocable* by description; supports supporting
  files and forking into subagents. In current Claude Code, commands and skills have converged — a
  command file and a skill of the same name both create `/x`. The skills here are deliberately
  user-invoked (you run `/team-deploy` on purpose), so they remain commands.
- A **subagent** is `.claude/agents/x.md`; isolated context, scoped tools, own model; the worker a
  command delegates to. Subagents do **not** inherit the main system prompt.

### 4.2 Command catalog (38)

🆕 marks the seven commands added during this engagement.

| Command | New? | Purpose | Args |
|---|:--:|---|---|
| `/team-a11y` |  | WCAG audit & accessibility remediation pass | `[page path \| all-pages \| components]` |
| `/team-ai-safety` | 🆕 | Safety & age-appropriateness eval for LLM & virtual-human agents | `[audit \| red-team \| age-gate <band> \| factuality]` |
| `/team-analytics` |  | Build/validate analytics + APM dashboards | `[report \| dashboard \| apm \| custom-query]` |
| `/team-architect` |  | Architecture-first design for a new system/component | `<system or component>` |
| `/team-backup` |  | Backup, restore & disaster-recovery planning | `[audit \| backup-now \| restore-test \| drplan]` |
| `/team-bugfix` | 🆕 | Triage & auto-fix bugs from the BUG_LRS (read → fix → close) | `[errors \| client \| server \| <keyword> \| install \| audit]` |
| `/team-cache` |  | Audit & tune caching for cost/latency/consistency | `[cache layer \| all]` |
| `/team-clean` |  | Sweep dead code, smells & style drift | `[full \| <dir> \| current branch]` |
| `/team-content` |  | Generate/import/tune content via the LLM gateway | `[generate <topic> \| import <path> \| tune-prompt <sys> \| bulk-precache <scope>]` |
| `/team-cost` | 🆕 | Govern LLM + cloud spend; find cost runaways | `[audit \| llm \| infra \| budget]` |
| `/team-database` |  | DB review, query optimization & migration safety | `[schema \| queries \| migration \| indexes]` |
| `/team-debt` |  | Audit & prioritize technical debt | `[full \| <module> \| recent changes]` |
| `/team-deploy` |  | Build, package & deploy the application | `[dev \| staging \| production \| rollback]` |
| `/team-deps` |  | Audit/upgrade dependencies + env-config parity | `[audit \| upgrade-safe \| upgrade-major \| env]` |
| `/team-docs` |  | Author, refresh & demo project documentation | `[audit \| api \| guides \| demo <feat> \| refresh <file>]` |
| `/team-dx` |  | Improve onboarding & inner-loop dev speed | `[onboarding \| inner-loop \| tooling \| audit]` |
| `/team-efficacy` | 🆕 | Design/analyze learning-outcome efficacy studies | `[design <study> \| analyze <data> \| power \| review]` |
| `/team-eval` | 🆕 | Build/run LLM-output evaluation & regression gates | `[build <task> \| run \| regress \| drift]` |
| `/team-feature` |  | Full feature build with a coordinated team | `<feature description>` |
| `/team-flags` |  | Design, ship & clean up feature flags | `[add <flag> \| audit \| cleanup]` |
| `/team-gcs` |  | Use Google Cloud Storage as primary persistence | `[design <data-type> \| audit \| migrate-from-localstorage \| version-strategy]` |
| `/team-help` | 🆕 | Install/audit the app-wide contextual "?" help assistant | `[install \| audit \| wire-server \| tts \| analytics \| tag <area>]` |
| `/team-i18n` |  | Hash-based i18n audit & implementation (canonical) | `[<files> \| audit]` |
| `/team-incident` |  | Triage & resolve a production incident | `<symptom description>` |
| `/team-load` |  | Frontend load & runtime performance pass | `[page path \| all-pages \| route group]` |
| `/team-monitor` |  | Observability & health monitoring across the stack | `[setup \| dashboard \| alerts \| audit]` |
| `/team-performance` |  | Full perf analysis (front+back+cache) & optimization | `[<files/dirs> \| full]` |
| `/team-privacy` | 🆕 | Student-data privacy & compliance (FERPA/COPPA/GDPR-K/PIPL) | `[audit \| dpia \| retention \| dsar \| minors]` |
| `/team-refactor` |  | Large-scale, multi-pass refactor with safety nets | `[<dir> \| <module> \| current branch]` |
| `/team-review` |  | Comprehensive parallel code review | `[<files> \| (default: recent changes)]` |
| `/team-security` |  | Comprehensive security audit | `[full \| api \| frontend \| auth \| dependencies \| infrastructure]` |
| `/team-test-e2e` |  | End-to-end browser tests for user journeys | `[<journey> \| all]` |
| `/team-test-integration` |  | Integration tests across module boundaries | `[<route prefix> \| <service> \| all]` |
| `/team-test-load` |  | Load testing & benchmarking under concurrency | `[<endpoint> \| <service> \| full]` |
| `/team-test-unit` |  | Generate & validate unit tests | `[<file> \| <module> \| uncovered functions]` |
| `/team-ux` |  | End-to-end UX design & audit | `[audit \| journey <name> \| component <name> \| redesign <page>]` |
| `/team-xapi` |  | Instrument/query xAPI learning analytics | `[instrument <feat> \| query <goal> \| audit \| verb-taxonomy \| performance]` |
| `/team-xgh-gateway` |  | OAuth + SMTP via the oauth.xiangenhu.info gateway | `[oauth \| smtp \| user-auth \| audit \| health-check]` |

**Disambiguation of close siblings** (so you reach for the right one):

- Quality quartet: `/team-review` (assess) · `/team-clean` (remove dead code) · `/team-debt`
  (prioritise) · `/team-refactor` (restructure). Table lives in `code-quality.md`.
- Performance trio: `/team-performance` (whole system) delegates Core Web Vitals to `/team-load`
  (frontend) and concurrency to `/team-test-load`.
- Reliability: `/team-incident` (live firefighting) vs `/team-bugfix` (steady-state captured-bug queue).
- LLM quality: `/team-eval` (is the *output* good?) vs `/team-efficacy` (does the *learner* improve?)
  vs `/team-ai-safety` (is it safe/age-appropriate?).

### 4.3 Shared reference docs (`_shared/`, 8)

| File | Type | Used by |
|---|---|---|
| `storage-invariants.md` | invariant | gcs, database, i18n, cache, content, backup, privacy |
| `roles.md` | invariant | security, privacy, gcs, xapi, architect, feature, ux, review, test-e2e, ai-safety, content, database |
| `llm-gateway.md` | invariant | content, help, eval, ai-safety, cost |
| `cache-invariants.md` | invariant | cache, content, performance, gcs (+ variant-pool section) |
| `learning-ux.md` | invariant | ux, a11y, content, feature, help, architect, review, docs |
| `code-quality.md` | reference | review, clean, debt, refactor |
| `security-baseline.md` | reference | security, feature, help, bugfix |
| `CONTEXT_HELP.md` | full spec | help |
| `BUG_TRACKING_AND_FIXING.md` | full spec | bugfix |

### 4.4 Subagents (manifest)

The commands delegate to **56** named subagents. The bundle ships `agents/AGENTS.md` (the manifest,
with a computed used-by map and job-shaped slug recommendations), a `_TEMPLATE.md`, and 3 exemplars
(`code-reviewer`, `architect`, `privacy-officer`). **Status: Stub.** Until the rest are authored, a
command will role-play a persona in the main context rather than delegate to an isolated worker.
Authoring the ~12 highest-traffic agents first (architect, code-reviewer, vuln-scanner, dba,
qa-testing, data-analyst, fullstack-developer + the 5 new domain agents) captures most of the value.

---

## 5. Layer B — `@uals/skill-runtime`

### 5.1 Module map

| Module | Status | Role |
|---|---|---|
| `src/config.js` | Implemented | One `.env` contract; required vars fail loud at `mount()`; optional features no-op when unset. |
| `src/store/gcs.js` | Implemented | The only persistence layer; `get/set/mutate/listByPrefix/getBuffer/putBuffer`; **CAS via `ifGenerationMatch`**. |
| `src/llm/gateway.js` | Implemented | The one `callLLM()`; injects the language directive; routes cache + accounting. |
| `src/llm/cache.js` | Implemented | Variant-pool cache (`plan/list/add`); backends `gcs` (default) / `lrs` / `off`. |
| `src/llm/accounting.js` | Implemented | Per-user/feature/model token rollups in GCS; cost estimate from `LLM_PRICES`; `summary()`. |
| `src/llm/routes.js` | Implemented | Admin-only `GET /api/admin/llm-usage`. |
| `src/roles/authz.js` | Implemented | `requireRole/requireAdmin/canAccess/requireAccess` over `req.user`. |
| `src/xapi/client.js` | Implemented | Learning LRS client; **targeted queries only**; verb taxonomy, no fallback. |
| `src/i18n/hash.js` | Implemented | Hash-based i18n; registry in GCS; `addText/t`. |
| `src/help/routes.js` + `grounding.js` | Implemented | Help endpoints (config/ask/analytics) on GCS + gateway; analytics Admin-only. |
| `src/help/assist.js` | Implemented & tested | In-place work-surface help (P3): `POST /api/assist`, scaffold-not-solve, gateway-routed, not cached. |
| `public/contextual-help.js` | Specified (verbatim) | The drop-in client IIFE from `CONTEXT_HELP.md`, shipped as-is. |
| `src/bug/{reporter,routes,fetch,fixlog}.js` | Implemented | Server capture, telemetry routes, shared fetch/dedup, **fix-log in GCS**. |
| `scripts/bug-triage.js` | Implemented | Triage CLI (`--since/--mark-fixed/--dismiss/--reset` + minimal menu). |
| `install.js` | Implemented | Cross-platform Node installer for the `.claude/*` files. |
| `POST /api/tts` | Specified (not mounted) | Read-aloud; the one piece with a hard provider dependency — wire from `CONTEXT_HELP.md §11.4`. |
| LLM→xAPI telemetry emitter | Not built (Decision) | Optional "log every interaction as xAPI for research" — separate from the serving cache (§11). |

### 5.2 Runtime architecture

```
                        req.user = { id, role, email, classIds? }   (your auth/XGH gateway sets this)
                                              │
Express app ── mount(app, {help, bug, cost}) ─┤
                                              ├── /api/help/*        help/routes ─┐
                                              ├── /server/telemetry/* bug/routes  │
                                              └── /api/admin/llm-usage llm/routes  │
                                                                                  │
   callLLM({system,user,lang,userId,feature,cache})  ◄───────────────────────────┘
        │  inject language directive (consistency)
        │  hash(model + system + user)              ── language in key by construction
        ├─ cache.list(hash) ──► variant pool ─ plan(n, CACHE_MAX)
        │        0 → generate sync, store #1
        │        0<n<MAX → serve cached now + background-fill
        │        n≥MAX → serve cached
        ├─ callProvider() ── the ONLY provider call site
        └─ accounting.record({userId,feature,model,usage,cached}) ──► GCS usage/{date}/{userId}.json
                                                                          │
                store/gcs.js (CAS) ──────────────────────────────────────┘  (one persistence layer)
```

---

## 6. Key end-to-end flows

### 6.1 Any LLM request (the gateway path)

1. Caller invokes `callLLM({ system, user, lang, userId, feature, cache })`. No caller talks to a
   provider directly.
2. The gateway appends `Respond in {language}. Do not switch languages mid-answer.` when `lang` is
   given — **language consistency is centralised**, not per-feature.
3. If caching is on for this call, hash `model + final-system + user` (so the language directive is in
   the key). Read the variant pool and apply `plan(n, CACHE_MAX)`:
   - `n = 0` → call the provider synchronously, return it, store variant #1.
   - `0 < n < MAX` → return a random cached variant immediately; fire a non-blocking background
     generation to grow the pool.
   - `n ≥ MAX` → return a cached variant; generate nothing.
4. Real calls record token usage; cache hits record `cached` at ~0 cost. **No call escapes accounting
   because none bypasses the gateway.**

### 6.2 Contextual help ask

`contextual-help.js` (chip + dwell/double-tap-Shift/F1) captures the DOM snippet, nearest heading, and
view, and POSTs to `/api/help/ask`. The server composes a tour-guide system prompt (+ grounding doc
from GCS), enforces input caps, checks a first-turn GCS cache (`cache/help:*`), and otherwise calls the
gateway. `GET /api/admin/help-analytics` aggregates by `locationId` and is **Admin-only**. *Privacy
note:* the snippet and question can carry learner PII — redact before send/cache for minors (§7.3).

### 6.3 Bug capture → triage → fix

Client/server reporters build xAPI `failed` statements (long text in `context.extensions`, never
`result.response`) and POST to the dedicated **BUG_LRS** — kept separate from the learning LRS so error
noise never pollutes learning analytics. `bug-triage.js` fetches, dedups, categorises, scores, and
writes `bug-triage-report.md`; the **fix log lives in GCS** (`cache/bugfix/log.json`) so the admin tab
and CLI stay in sync on Cloud Run. `/team-bugfix` reads that report, fixes sequentially (treating bug
text as untrusted input — an injection vector), verifies, and closes via `--mark-fixed`. It never
commits.

---

## 7. Cross-cutting concerns

### 7.1 Storage (GCS-only, CAS)
One bucket, role-scoped paths (`users/{id}`, `classes/{id}`, `frameworks/owner/{id}`, `config/`,
`i18n/registry.json`, `cache/…`, `usage/…`). CAS uses object **generation preconditions**
(`ifGenerationMatch: 0` to create-if-absent, `= N` for optimistic update, retry on 412). Access is
decided by `(role, membership)`, enforced server-side via IAM/signed URLs.

### 7.2 Roles & authorization
`req.user = { id, role, email, classIds? }`, populated by your auth/XGH gateway *before* `mount()`.
`requireAdmin` gates admin endpoints; `canAccess(user, resource)` implements the membership rule
(Educator needs the class; Learner only self; Admin all, audited).

### 7.3 Privacy & minors
- **Minimise + pseudonymise.** Accounting and analytics key on an **opaque userId**, never an email.
- **No learner PII in prompts/logs/caches.** Redact before the gateway; do **not** pool-cache
  personalised or learner-PII requests (a pooled variant is served to anyone matching the hash).
- **Bug telemetry** pseudonymises the actor; a minor's email/data must not reach the BUG_LRS.
- **Erasure** must reach every GCS version, cache object, the LRS(es), and backups — one store makes
  this tractable.

### 7.4 LLM gateway, language, cost
The gateway is the chokepoint (§3, §6.1). Cost = tokens × `LLM_PRICES` (USD per 1M; configurable;
**prices drift — keep current**). Read usage Admin-only at `GET /api/admin/llm-usage?since=7d&group=user|feature|model|total`.

### 7.5 Variant-pool caching
See `cache-invariants.md` (Variant-pool section). Default store **GCS**; optional **dedicated** cache
LRS (`LLM_CACHE_BACKEND=lrs` + `LLM_CACHE_LRS_*`), never the learning LRS. Pool only PII-free,
context-complete, idempotent requests.

### 7.6 i18n
Hash-based (SHA-256, first 16 hex of trimmed English). Registry and language files in GCS, never the
repo. The client honours the echo-of-source guard (titles in English source; the i18n sweep translates).

### 7.7 xAPI
Two stores, deliberately separate: the **learning LRS** (`xapi/client.js`, targeted queries + verb
taxonomy that throws on unknown verbs) and the **BUG_LRS** (`failed` verb, exempt from the learning
taxonomy). An optional cache LRS is a third, also separate.

---

## 8. Configuration (`.env` contract)

| Group | Variables | Required? |
|---|---|---|
| App identity | `APP_SLUG`, `APP_URL`, `NODE_ENV`, `PORT` | recommended |
| GCS (persistence) | `GCP_PROJECT_ID`, `GCS_BUCKET_NAME`, `GCS_KEY_FILE` (local dev only) | `GCS_BUCKET_NAME` **required** |
| LLM gateway | `LLM_GATEWAY_ENDPOINT`, `LLM_GATEWAY_API_KEY` (or `OPENAI_API_KEY`), `LLM_MODEL`, `LLM_MAX_TOKENS` | key **required** for help/content |
| LLM cost | `LLM_PRICES` (JSON, USD/1M) | optional (defaults seeded) |
| LLM cache | `LLM_CACHE_BACKEND`, `LLM_CACHE_DEFAULT`, `CACHE_MAX`, `LLM_CACHE_TTL_DAYS`, `LLM_CACHE_LRS_*` | optional |
| Learning LRS | `LRS_ENDPOINT`, `LRS_USERNAME`, `LRS_PASSWORD` | optional (xAPI features) |
| Bug LRS | `BUG_LRS_ENDPOINT`, `BUG_LRS_USERNAME`, `BUG_LRS_PASSWORD`, `BUG_APP_ID` | optional (no-op if unset) |
| Help | `HELP_HOVER_DWELL_MS`, `HELP_GROUNDING_GCS_PATH` | optional |
| TTS | `OPENAI_API_KEY`, `TTS_MODEL`, `TTS_VOICE` | optional |
| i18n / misc | `LANG_COOKIE`, `I18N_REGISTRY_GCS_PATH`, `BUG_FIXLOG_GCS_PATH` | optional |

Full annotated list: `runtime/.env.example`.

---

## 9. Installation & wiring

**Skills (dev-time):**
```bash
node runtime/install.js /path/to/project        # copies commands + _shared + agents into .claude/
```
Commands pull shared docs via `@.claude/commands/_shared/…` (project-root-relative).

**Runtime (run-time):**
```bash
cd runtime && npm install && cp .env.example .env   # edit .env
```
```js
const { mount, errorHandler, bug } = require('@uals/skill-runtime');
bug.attachProcessHandlers();                          // earliest — process + console capture
mount(app, { help: true, bug: true, cost: true });    // /api/help/*, /server/telemetry/*, /api/admin/llm-usage
// ... your routes ...
app.use(errorHandler);                                // last — route-error capture
```
Serve `public/contextual-help.js`, add `<script src="/contextual-help.js?v=1">` per page, and set
`CFG.appSlug === APP_SLUG`. Populate `req.user` (id, role, email, classIds) before `mount()`.

---

## 10. Implementation status (honest accounting)

| Capability | Status | Note |
|---|---|---|
| GCS store + CAS | Implemented | CAS path not exercised against a live bucket in this build (see §12). |
| LLM gateway (language, accounting, cache) | Implemented & unit-tested | Provider call shape assumes OpenAI-compatible. |
| Variant-pool cache | Implemented & unit-tested | GCS backend default; LRS backend functional, untested live. |
| Cost accounting + admin endpoint | Implemented & unit-tested | Prices configurable; defaults are a snapshot. |
| Roles/authz | Implemented & unit-tested | Reads `req.user`; you wire the auth source. |
| xAPI client | Implemented | Verb guard + targeted-query guard tested; live LRS not exercised. |
| Help feature | Implemented (server) / Specified (client verbatim) | TTS not mounted. |
| Bug feature + CLI | Implemented | Fix-log moved to GCS for Cloud Run correctness. |
| 56 subagents | Stub | Manifest + template + 3 exemplars; author the rest. |
| LLM→xAPI research telemetry | Not built | Decision §11. |

---

## 11. Open decisions to resolve before production

1. **Caching default.** `LLM_CACHE_DEFAULT=false` (opt-in per call) is the safe default — personalised
   routes must not pool. Decide whether to flip it on globally; if so, audit which routes opt out.
2. **Cache store: GCS vs LRS.** Recommendation is GCS for the *serving* cache. If you also want every
   interaction queryable as xAPI for research, that is a *separate* telemetry emitter, not the cache —
   say the word and it will be added.
3. **Gateway contract.** `llm/gateway.js` targets an OpenAI-compatible `/chat/completions`. If your XGH
   gateway differs, only that file changes (the `callLLM({system,user})` signature is the contract).
4. **Auth shape.** Confirm what your auth middleware puts on `req.user`; `authz.js` will be adapted to
   your field names rather than the reverse.
5. **`LLM_PRICES`.** Seed the table for your actual model set (XGH-routed models), and keep it current.
6. **Module system.** Runtime is CommonJS to match the specs; convert to ESM if your app is ESM.
7. **Subagents.** Author the high-traffic agents (or migrate commands to skills with `context: fork`).

---

## 12. Validation performed in this build

- Every runtime `.js` passes `node --check` (20 files).
- Express installed in a sandbox; module graph loads and `mount()` serves
  `GET /api/config/help-hover → 200`.
- Unit checks pass for: authz (401/403/pass + Educator-needs-class-membership, Learner-self-only),
  the xAPI verb guard (throws on unknown), i18n hashing (16 hex, trim-stable), the bug statement shape
  (pseudonymised actor, no `result.response`, silent no-op when unconfigured), cost math + rollup
  merge, the central language directive, and the variant-pool cache (cold/warm/full/off + background fill).
- **Not exercised:** live GCS writes (CAS), a live LLM round-trip, and live LRS calls — no bucket,
  provider key, or LRS in the build environment. Confirm these three on first run.

---

## 13. Version history (v1 → v2.6)

| Version | Change |
|---|---|
| v1 → v2.0 | Critique; merged `i18n`+`i18n-hash`; extracted shared refs; added domain commands (privacy, ai-safety, eval, efficacy, cost); agents manifest; YAML frontmatter on all commands. |
| v2.1 | Project invariants: `storage-invariants.md`, `roles.md`; reframed `team-database` (GCS is the store). |
| v2.2 | `team-help` + `CONTEXT_HELP.md` spec; fixed `@`-reference paths to `@.claude/commands/_shared/…`. |
| v2.3 | `team-bugfix` + `BUG_TRACKING_AND_FIXING.md`; fix-log → GCS; BUG_LRS kept separate; injection guard. |
| v2.4 | `@uals/skill-runtime`: config, GCS store, gateway, roles, xAPI, i18n, help + bug features, Node installer. |
| v2.5 | Single-gateway invariant (`llm-gateway.md`) + central language directive + per-user token accounting + `/api/admin/llm-usage`. |
| v2.6 | Variant-pool LLM cache (`CACHE_MAX`, gcs/lrs/off); cost-aware; GCS-over-LRS recommendation. |
| v2.7 | Learning-first UX invariant (`learning-ux.md`, 4 principles); `team-ux` Phase 0; `POST /api/assist` (P3). |

---

## 14. File inventory

- `skills/team-*.md` — 38 commands · `skills/_shared/*` — 8 docs (6 invariants/refs + 2 specs)
- `agents/` — `AGENTS.md` (56) + `_TEMPLATE.md` + 3 exemplars
- `runtime/` — 23 files (see §5.1) incl. `src/`, `public/contextual-help.js`, `scripts/bug-triage.js`,
  `install.js`, `package.json`, `.env.example`, `README.md`
- Root — `README.md`, `CRITIQUE.md`, `CHANGELOG.md`, `install.sh`, this `SYSTEM_REFERENCE.md`

---

## Appendix — sources for Claude Code facts (dated)

- Slash commands (frontmatter, `$ARGUMENTS`, `@`-refs resolve from project root):
  code.claude.com/docs/en/slash-commands; claudedirectory.org cheat sheet (2026-04-22). Accessed 2026-05-30.
- Subagents (`.claude/agents/*.md`; name/description/tools/model; don't inherit main prompt):
  code.claude.com/docs/en/sub-agents. Accessed 2026-05-30.
- Commands and skills converged; skills add auto-invocation + `context: fork`:
  levelup.gitconnected.com (2026-03-04); antstack.com (2026-03-09).
- Job-shaped agent names route better than generic role names: builder.io (2026-04-16).

*Library/runtime facts (e.g. `@google-cloud/storage` generation preconditions, the OpenAI-compatible
chat-completions shape) are standard, stable APIs and were not re-verified against live services in
this build; confirm on first run as noted in §12.*
