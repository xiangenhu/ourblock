# help-kit — installable contextual "?" help assistant

Packages this repo's app-wide contextual **"?" help assistant** runtime so it can be dropped into
another app: one self-contained client module (floating chip + dwell/hotkey chat card) plus the
Express routes that answer questions, cache to GCS, and expose per-location analytics.

This README is the **install / packaging layer**. The canonical **design spec** — every swap slot,
the full drop-in rationale, the hotkey/caching/markdown invariants — is
`@.claude/commands/_shared/CONTEXT_HELP.md`. Read that for *why*; read this for *how to install*.

Owning skill: **`/team-help`**.

## What it installs

| File | Installed to (default) | Role |
|------|------------------------|------|
| `runtime/public/contextual-help.js` | `client/public/contextual-help.js` | One-file IIFE: chip + draggable card, DOM context extractor, double-tap-Shift/F1/dwell triggers, tiny markdown renderer, localStorage first-turn cache, optional TTS + feedback launcher. No build step, no deps. |
| `runtime/server/help.js` | `server/help/help.js` | Express router: `GET /config/help-hover`, `POST /help/ask`, `GET /admin/help-analytics`. PII redaction, grounding-doc load, first-turn GCS cache, CAS-safe frequency bump. |
| `runtime/server/helpStore.js` | `server/help/helpStore.js` | GCS-backed KV for the help cache + analytics: `get`, `getBuffer`, `putBuffer`, `mutate` (CAS via `ifGenerationMatch`), `listByPrefix`, `isConfigured`. No-ops gracefully without GCS. |

Files are copied **verbatim** — the installer does not rewrite `require(...)` paths. You do that once
by hand (below); it's two lines.

## Quick start

```bash
# from the source repo, install into a target app
node .claude/commands/_shared/kits/install.mjs help --app <target-app-dir>

# preview without writing
node .claude/commands/_shared/kits/install.mjs help --app <dir> --dry-run

# overwrite existing files
node .claude/commands/_shared/kits/install.mjs help --app <dir> --force

# override a group's dest dir (group ids: public, server)
node .claude/commands/_shared/kits/install.mjs help --app <dir> --server-dir server/routes/help
```

After copy, the installer prints the manual **wiring** steps (also in `kit.json`).

## Integration contract — swap slots

The copied server files `require(...)` five app-provided modules plus one sibling. Satisfy each with
your app's equivalent (this app's shapes are documented so you can match them):

| `require` in copied file | Points at | Contract the installing app must satisfy |
|--------------------------|-----------|-------------------------------------------|
| `../services/helpStore` (in `help.js`) | the **sibling** kit file | **Repoint to `./helpStore`** — after install both live in `server/help/`. |
| `./storage` (in `helpStore.js`) | app GCS service | **Repoint to `../services/storage`** (or wherever storage lives relative to `server/help/`). Must expose `getBucket()`, `isConfigured()`. |
| `../services/storage` (in `help.js`) | app GCS service | Same service. Uses `isConfigured()` + `downloadFile(name)` (for the grounding doc). Unchanged if storage is at `server/services/storage`. |
| `../services/llmGateway` (in `help.js`) | LLM chokepoint | Destructured `{ llmGateway }`; needs `llmGateway.chat(messages, opts)` returning a string or `{ content }`. Route ALL model calls through this one gateway — never a provider SDK directly. |
| `../middleware/auth` (in `help.js`) | auth middleware | Destructured `{ optionalAuth, requireAdmin }`. `optionalAuth` is a single middleware fn (populates `req.user` if a token is present, never 401s). `requireAdmin` is a **middleware array** (spread as `...requireAdmin`) gating Admin-only. |
| `../utils/language` (in `help.js`) | i18n names | Destructured `{ LANGUAGE_NAMES }` — a `{ code: 'English name' }` map used to build the `Respond in {name}` prompt line (this is what puts language into the cache key by construction). |

Two more soft dependencies:

- **cookie-parser** — `langFromReq()` reads `req.cookies.preferredLanguage`. Optional: it also falls
  back to `?lang=` and the `x-app-lang` header, so the route works without cookies; language just
  defaults to `en` more often.
- **Grounding doc** (optional) — `help.js` loads `HELP_GROUNDING_DOC` from GCS (default
  `shared/help/grounding.md`), falling back to a bundled `server/data/help-grounding.md`. Ship one to
  ground "why is this here?" answers; omit it and the bot answers purely from the on-screen DOM snippet.

### Client CFG block

Edit the `CFG` object at the top of `contextual-help.js`:

| Field | Purpose |
|-------|---------|
| `appSlug` | Namespace prefix in `locationId` = `{appSlug}:{pathKey}:{locationKey}` (joins help analytics ↔ feedback). |
| `api.config` / `api.ask` | Paths to the two routes. Defaults are `/api/*`; **this app mounts under `/server`**, so set `/server/config/help-hover` and `/server/help/ask`. |
| `langCookie` | Name of your locale cookie (client reads `window.I18n?.lang` first, then this cookie). |
| `feedbackUrl` | Optional external feedback-wizard URL (`sourceID` pre-filled). `null` hides the Feedback button. |
| `footerText` | One-line stance shown in the card footer. |

Optionally tune `findMeaningfulContainer()`'s interest-selector list to match your modal / nav /
form-row class names, and sprinkle `data-help="label"` on UI you want stable analytics for.

## Endpoints (from `help.js`)

| Method + path (relative to mount) | Auth | Returns |
|-----------------------------------|------|---------|
| `GET /config/help-hover` | public | `{ dwellMs, enabled }` — `dwellMs=0` disables auto-open globally. `Cache-Control: 60s`. |
| `POST /help/ask` | public (`optionalAuth`) | `{ answer, cached }`. Validates + caps inputs, redacts PII, builds `locationId`, first-turn GCS cache lookup, else `llmGateway.chat`, then CAS bump. `400` on oversize question; `500` → `{ error:'Help unavailable' }`. |
| `GET /admin/help-analytics` | **Admin** (`...requireAdmin`) | Aggregated by `locationId` (`?group=location`, default) or per-hash (`?group=none`), `?limit` 50–2000. |

`/help/ask` is public **by design** — the chip appears on pre-sign-in pages. Protect it with a rate
limiter at mount time (this app uses `llmLimiter`, 20/min) and rely on the built-in input caps.

## Hard invariants (do not break when lifting)

- **Idempotent boot.** The client guards on `window.__contextualHelpInstalled`; duplicate `<script>`
  tags are safe. Keep it — pages often include it more than once.
- **Single capture-phase keydown listener.** `document.addEventListener('keydown', onKey, true)` is
  attached **exactly once**. The modifier-aware double-tap-Shift logic (with the `e.repeat` filter and
  `shiftSequenceBroken` reset) is the conflict-free hotkey — lift it verbatim. A second listener on
  `window` would double-count events and turn a single Shift into a false double-tap.
- **Hash-i18n echo-of-source guard.** All `title`/label attributes are set in the **English source
  string**, never `t(...)`, so a hash-based i18n sweep captures the correct source and never asks the
  translator to translate a language into itself.
- **Language is in the cache key by construction.** The system prompt embeds the language name; the
  server cache key = `shortHash(system + userPrompt)`. A non-English reader can never be served an
  English cached answer. Don't hoist language out of the prompt.
- **First-turn-only caching.** Only the first assistant turn is cached (client localStorage + server
  GCS). Follow-ups depend on conversation state and must stay uncached.
- **GCS-only persistence, CAS-safe counters.** Cache + analytics live in GCS via `helpStore`. The
  frequency bump uses `ifGenerationMatch` with bounded retries so concurrent asks don't lose counts.
  Everything no-ops (answer, don't persist) when GCS is unconfigured — never 500 for lack of a bucket.
- **Admin-only analytics.** `/admin/help-analytics` is gated by `requireAdmin`. The persisted cache doc
  carries **no user identity** (aggregated + identity-free); PII is redacted from question/snippet/history
  before it reaches the LLM or the doc.

## Requirements

- `GCS_BUCKET_NAME` (+ GCS credentials) for cache + analytics persistence. Absent → feature degrades to
  live-answer-only, no persistence.
- At least one LLM provider configured behind your `llmGateway`.
- Optional env: `APP_SLUG`, `HELP_HOVER_DWELL_MS` (default 3000), `HELP_MAX_TOKENS` (400),
  `HELP_LLM_PROVIDER`, `HELP_LLM_MODEL`, `HELP_GROUNDING_DOC`.

## Verify

```bash
# 1. dry-run lists the four files, no error
node .claude/commands/_shared/kits/install.mjs help --app /tmp/helptest --dry-run

# 2. real install lands them
node .claude/commands/_shared/kits/install.mjs help --app /tmp/helptest
ls /tmp/helptest/client/public/contextual-help.js /tmp/helptest/server/help/{help,helpStore}.js

# 3. server files parse
node --check /tmp/helptest/server/help/help.js
node --check /tmp/helptest/server/help/helpStore.js
```

Then in the target app: repoint the two `require` paths, mount the router, load a page, hit the chip
(or double-tap Shift), confirm `POST …/help/ask` returns an answer, and confirm the GCS `cache/help:*`
docs appear with `askCount` incrementing.

## Full design spec

`@.claude/commands/_shared/CONTEXT_HELP.md` — the complete portable design (swap-slot table, client
module notes, server endpoint contracts, frequency-bump pattern, multilingual path). This kit is the
runtime + installer for that spec.
