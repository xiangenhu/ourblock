# Changelog — UALS Team Skills (v1 → v2)

## Removed redundancy
- **Merged `team-i18n` + `team-i18n-hash` → `team-i18n`.** The hash version was declared "the
  preferred pattern"; keeping both invited the exact drift the bundle warns against. The generic
  approach survives as a "non-hash fallback" section. (32 → 31 base commands.)
- **Extracted shared references** to `skills/_shared/` so duplicated content lives in one place,
  pulled via Claude Code `@`-references:
  - `cache-invariants.md` — was restated in team-cache/content/performance/gcs.
  - `code-quality.md` — smell/debt/dead-code lists were restated in review/clean/debt/refactor;
    now includes a four-command disambiguation table.
  - `security-baseline.md` — quick gate referenced by security/feature/xgh-gateway.
- **Disambiguated overlapping commands** with delegation notes:
  `team-performance` now defers Core Web Vitals to `team-load` and load tests to `team-test-load`.

## Added (missing, domain-specific for an edtech/LLM app)
- `team-privacy` — student-data protection & compliance (FERPA/COPPA/GDPR-K/PIPL).
- `team-ai-safety` — safety + age-appropriateness eval for LLM & virtual-human agents.
- `team-eval` — LLM-output evaluation harness with regression gates (operationalizes the
  hand-wavy "sample-check output quality" in team-content).
- `team-efficacy` — learning-outcome experiment design & analysis (effect sizes, power, clustering).
- `team-cost` — LLM + cloud spend governance.

## Added (structural / functional)
- `agents/AGENTS.md` — manifest of all **56** subagents the commands delegate to (none shipped
  in v1), with a computed used-by map and job-shaped slug recommendations.
- `agents/_TEMPLATE.md` + 3 exemplar subagents (`code-reviewer`, `architect`, `privacy-officer`).
- **YAML frontmatter** (`description`, `argument-hint`) on every command, for the `/`-picker.
- Installer now also places `_shared/` and `agents/`.

## Not changed (left for your judgment)
- `allowed-tools` frontmatter (safe hardening, but project-specific — see CRITIQUE.md §Next steps).
- Migration from `.claude/commands/` to `.claude/skills/` (commands and skills have merged in
  current Claude Code; skills add auto-invocation, supporting files, and `context: fork`).

## v2.1 — project invariants (per your three rules)
- **`_shared/storage-invariants.md`** (new): GCS is the only persistence layer; `localStorage`
  never holds data; hash-based i18n language files + registry always in GCS. Wired into gcs,
  database, i18n, cache, content, backup, privacy. `team-database` reframed (GCS *is* the store,
  not an RDBMS); `team-gcs` localStorage section hardened; `team-i18n` storage made mandatory.
- **`_shared/roles.md`** (new): three-tier Admin/Educator/Learner model with an authorization
  matrix, deny-by-default + resource-level (membership) rules, and mappings to GCS paths, xAPI
  query scoping, auth claims, and UI journeys. Wired into security, privacy, gcs, xapi, architect,
  feature, ux, review, test-e2e, ai-safety, content, database.
- One judgment call left to you: a narrow `localStorage` carve-out for *transient UI-only state*
  (not data). Delete it in `storage-invariants.md` if you want a literal zero-`localStorage` policy.

## v2.2 — contextual help + @-path fix
- **`team-help`** (new): installs/audits the app-wide contextual "?" assistant following the
  bundled spec, bound to project invariants — persistence on **GCS** (not the spec's filesystem
  impl), **hash-based i18n** with GCS-hosted language files, `/api/help/ask` routed through the
  **unified LLM gateway**, **Admin-only** analytics endpoint, and a **privacy/age-appropriateness
  gate** (snippet/question can carry minor PII; redact before send + cache).
- **`_shared/CONTEXT_HELP.md`** (new): the canonical help spec, shipped so `@`-references resolve
  after install.
- **Fix:** all shared-doc references corrected from `@_shared/…` to `@.claude/commands/_shared/…`.
  Claude Code resolves `@` paths from the **project root**, so the short form silently missed —
  this affected the v2/v2.1 cross-references. Now correct for a project-scoped install.

## v2.3 — bug-fix loop
- **`team-bugfix`** (new): drives read → fix → close over the dedicated BUG_LRS following the
  bundled spec, bound to invariants — **fix log in GCS** (the doc's local `bug-fix-log.json` is
  per-instance/lost on Cloud Run, breaking the admin-tab↔CLI sync guarantee), **BUG_LRS kept
  separate** from the learning LRS (and its `failed` verb exempt from the learning taxonomy),
  **PII redaction + pseudonymized actor** (minor email/data must not reach BUG_LRS), an
  **injection guard** (bug text is untrusted input to the auto-fixer), Admin-only surfaces, and
  never-commit. Disambiguated from `/team-incident` (live firefighting) on both files.
- **`_shared/BUG_TRACKING_AND_FIXING.md`** (new): canonical spec, shipped so `@`-refs resolve.

## v2.4 — Node.js runtime backbone
- **`runtime/`** (new): `@uals/skill-runtime`, the shared CommonJS backbone the skills assume —
  config (the `.env` contract), GCS store with **CAS via generation preconditions**, the unified
  **LLM gateway**, three-tier **RBAC** middleware, an **xAPI client** (targeted-only + verb guard),
  **hash-based i18n** (GCS registry), the **contextual-help** server routes + the verbatim
  `public/contextual-help.js` client, and the **bug** reporter + telemetry routes + `bug-triage.js`
  CLI (**fix log in GCS**, not a local file). Plus `install.js` (cross-platform Node installer for
  the `.claude/*` files), `package.json`, `.env.example`, README.
- Smoke-tested: module graph loads, `mount()` serves `/api/config/help-hover`, and unit checks
  pass for authz (deny-by-default + resource-level), the xAPI verb guard, i18n hashing, and the
  bug statement shape (pseudonymized actor, no `result.response`, silent no-op when unconfigured).
- Deliberately not bundled: `node_modules` (run `npm install`), and `/api/tts` (the one piece with
  a hard provider dependency — wire from `CONTEXT_HELP.md §11.4`).

## v2.5 — single-gateway invariant + per-user token accounting
- **`_shared/llm-gateway.md`** (new invariant): ALL LLM calls go through one gateway — no feature
  imports a provider. Wired into content, help, eval, ai-safety, cost. The gateway centralizes
  (1) **language consistency** (inject `Respond in {lang}…` for every call given `lang`) and
  (2) **token accounting**, so neither can be forgotten per-feature.
- **Runtime gateway upgraded**: `callLLM({ system, user, lang, userId, feature, … })` now injects
  the language directive centrally and records usage on every call; `callLLM.recordCacheHit()` logs
  cache hits (cost ~0). Back-compatible (returns the answer string).
- **`src/llm/accounting.js`** (new): per-user/feature/model token rollups in GCS
  (`usage/{date}/{userId}.json`, CAS), configurable `LLM_PRICES`, and `summary({since,groupBy})`.
  Exposed Admin-only at **`GET /api/admin/llm-usage`** (mount `{ cost: true }`, default on).
- Help route now passes `userId/feature/lang` and records cache hits. Smoke-tested: language
  directive, cost math, rollup merge (calls/cached/tokens), and mount.

## v2.6 — LLM variant-pool cache
- **`src/llm/cache.js`** (new): per-request **variant pool** at the gateway. 0 cached → generate
  sync; 0<n<CACHE_MAX → serve a random cached variant immediately + background-fill one; n≥MAX →
  serve cached. Bounds cost to ≤ CACHE_MAX generations/request. Pluggable backend
  `LLM_CACHE_BACKEND=gcs|lrs|off` (**gcs default/recommended**; `lrs` = a *dedicated* cache LRS,
  variants as `generated` statements keyed by `{APP_URL}/llm-cache/{hash}` — never the learning LRS).
  Language is in the key by construction; `CACHE_MAX`, TTL, default-on are env-driven.
- Gateway integrated (cold/warm/full + background fill, non-blocking); cache hits recorded as ~0
  cost. Smoke-tested: `plan()` decisions and cold/warm/full/off paths.
- **Recommendation captured** in cache-invariants.md: keep the serving cache in GCS, not the
  learning LRS (avoids analytics pollution + the targeted-query constraint); pool only PII-free,
  context-complete, idempotent requests (team-privacy).

## v2.7 — Learning-first UX invariant
- **`_shared/learning-ux.md`** (new invariant): four principles for a learning app, grounded in
  cognitive-load theory — (P1) no entry jargon / progressive vocabulary, (P2) attractiveness =
  ease-of-reaching-content not density (distraction budget, time-to-content), (P3) in-place LLM help
  on every produce/critique/revise/evaluate surface that *scaffolds* not solves, (P4) tabs + modals
  for single-task focus (with explicit a11y boundaries and where modals hurt). Conflict-resolution
  order + audit checklist included. Wired into ux, a11y, content, feature, help, architect, review, docs.
- **`team-ux`** gained a "Phase 0: Learning-UX gate" (it previously had no focus/cognitive-load coverage).
- **Runtime `src/help/assist.js`** (new) implements P3: `POST /api/assist` (modes: critique /
  revise-suggestions / explain / hint / check) routed through the single gateway, **scaffold-not-solve**
  system framing, learner-auth required, personal artifacts **not** pool-cached, cost-tagged
  `assist:<mode>`, language forwarded. Mounted with `help`. Smoke-tested.

---

## v3.0 — consolidated release
First stable release consolidating all v2.x work into one coherent, validated bundle. No new scope
beyond v2.7; this entry marks the reconciliation:
- **Naming/versioning unified:** bundle ships as `uals-team-skills-v3`; `@uals/skill-runtime` → `3.0.0`;
  `SYSTEM_REFERENCE.md` → v3.0.
- **Integrity verified at release:** 38 commands all carry frontmatter; all `@.claude/commands/_shared/*`
  references resolve to existing files; every `/team-*` cross-reference points to a real command; no
  stale `@_shared/` short-form paths; all 21 runtime `.js` pass `node --check`; no `node_modules` shipped.
- **Contents:** 38 `/team-*` commands · 9 shared docs (7 invariants/refs + 2 specs) · 56-agent manifest
  (+ template + 3 exemplars) · `@uals/skill-runtime` (config, GCS store, LLM gateway+cache+accounting,
  roles, xAPI, i18n, help+assist, bug pipeline, Node installer).
- **Five enforced invariants:** GCS-only storage · three-tier roles · single LLM gateway · variant-pool
  cache · learning-first UX. Plus security-baseline and code-quality references.
- **Known follow-ups (carried, not blockers):** author the remaining ~53 subagents; resolve the 7
  open decisions in `SYSTEM_REFERENCE.md §11`; confirm live GCS CAS / LLM round-trip / LRS on first run.
