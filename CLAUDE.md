# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

优城美市 · **Our Block** — a place-based civic-wellbeing app. Residents capture what is **good** or **needs care** on their block; an AI routes each observation to the *lowest viable rung* of action (fix-it-yourself → rally-neighbours → send-to-city). Node + Express backend, vanilla-JS SPA, deployed on Cloud Run.

## Commands

```bash
npm start            # node server/index.js  → http://localhost:3000
npm run dev          # same, with --watch auto-restart
npm run kill         # stop a running server
npm test             # node --test over test/**/*.test.js (integration, over HTTP)
node --test test/api.test.js                      # one test file
node --test --test-name-pattern="health" test/api.test.js   # one test by name
```

Requires Node ≥ 20 (uses `process.loadEnvFile`, the native test runner, global `fetch`). No build step — the frontend ships as-is.

**Deployment** is a single container on Cloud Run (`Dockerfile`): `npm ci --omit=dev`, no build, runs `node server/index.js`. Cloud Run injects `PORT=8080` (the app already reads `PORT`). In production GCS auth is the attached service account via ADC — the local `server/gcs-key.json` keyfile is deliberately **not** copied into the image (`.dockerignore`), so never rely on its presence in deployed code.

**Tests need a real GCS bucket** (`GCS_BUCKET` in `.env`). They run under an isolated `GCS_PREFIX` (`obtest/<pid>`), force `OAUTH_ENABLED=off` (bcrypt path, no emails) and `LLM_VENDOR=none` (deterministic keyword heuristic). When GCS is unconfigured the whole suite **skips** rather than fails. The README's `npm run reset` is stale — there is no seed script (GCS migration removed it).

## Architecture — the invariants that span files

These three are project invariants, not conventions. Violating them is the most common way to break the app.

**1. GCS is the ONLY persistence layer** (`server/store/gcs.js`). There is no SQL DB and no local-disk fallback, despite what the README says. The data model *is* the GCS key layout (`server/store/repo.js`):
- `db/seq/{name}.json` — monotonic id source, `db/users/{id}.json`, `db/users-by-email.json` (login index), `db/posts/{id}.json`, `media/{uuid}.{ext}` (raw bytes).
- A **post doc is self-contained** — reactions, comments, and the care-loop steps live inline — so listing the feed is one prefix scan with zero per-post sub-reads. Preserve this; don't split post sub-collections into separate objects.
- Concurrent mutations use **CAS** via GCS generation preconditions: `store.mutate(key, initial, transform)` retries on `412`. Use it (and `posts.mutate`) for any read-modify-write; never plain `get` then `set` on contended docs.
- Auth on Cloud Run is ADC (no keyfile); locally it's `server/gcs-key.json` via `GOOGLE_APPLICATION_CREDENTIALS` (gitignored). All keys are namespaced under `config.gcs.prefix` so one bucket hosts many apps/test-runs.

**2. Every LLM call goes through ONE gateway** (`server/llm/gateway.js` → `callLLM(...)`). No feature code calls a provider's HTTP API directly. The gateway centralizes vendor choice (`LLM_VENDOR`: openai/anthropic/gemini/groq/deepseek/ollama), request "shape" (openai-compatible vs anthropic vs gemini), language enforcement, timeouts, multimodal image folding, and token accounting to GCS. Adding a vendor = one entry in `config.VENDORS`, not a change to the gateway (unless its wire shape is genuinely new). AI features **degrade gracefully**: `server/ai.js` (`classify`, `composePost`, `resolutionStory`) returns a keyword heuristic / template when `config.has.llm()` is false, so the app is fully functional with zero LLM config.

**3. Config is read in exactly one place** (`server/config.js`). Env is parsed here; nowhere else reads `process.env` for these. Pattern: `config.requireX()` throws a loud, specific error at the call site if used while unconfigured; `config.has.x()` returns a bool so callers can degrade. `server/env.js` must be imported **first** in every entrypoint (it loads `.env` before config is read); production has no `.env` and reads the real environment.

## Request flow & auth

`server/index.js` builds the Express app and **exports it without listening** — it only calls `listen()` when run as the main module, so tests import the app and bind an ephemeral port. `attachUser` middleware runs globally and sets `req.userId` from the `ob_token` JWT cookie (never rejects); routes opt into `requireAuth` / `requireAdmin` (`server/auth.js`).

- **Roles are derived server-side, never client-asserted.** The only elevated tier is the `TEACHER_EMAILS` allowlist (`config.teacherEmails`) = Admin/steward; `requireAdmin` re-checks the verified user's email.
- **Real auth is delegated** to the OAuth2+SMTP gateway at `oauth.xiangenhu.info` (`server/oauthGateway.js`) — Google sign-in and email-code verification. The app keeps only a lightweight profile keyed by email. Seeded/demo accounts sign in via local bcrypt, so the demo works with `OAUTH_ENABLED=off`.
- Media is never on local disk: uploads land in GCS and stream back through `/api/media/<key>` (`mediaRouter`).

## Frontend (`public/`)

Vanilla ES-module SPA, no framework, no bundler. `public/js/app.js` is the client router/render loop over a single `state` object; `api.js` wraps fetch, `ui.js` has the `h()` hyperscript helper + icons. Self-contained generative SVG avatars (`avatar.js`), client-side image crop/EXIF (`crop.js`, `exif.js`). UI strings use **hash-based i18n** (`public/js/i18n.js` + `server/routes/i18n.js`): the client registers English strings by hash; the server stores them and back-fills translations through the LLM gateway, so the next dict fetch for any language is complete. Maps are hybrid (`server/routes/maps.js`): Google globally, Amap (高德) in mainland China, self-hosted Leaflet tiles as fallback — tiles and reverse-geocoding are always proxied through our server, never hit OSM/Google directly from the browser.

## Other subsystems

- **Contextual help** (`server/help/`, `public/contextual-help.js`) — app-wide "?" assistant grounded in `server/help/grounding.md` (overridable via GCS object `config/help/grounding.md` without redeploy).
- **xAPI** (`server/xapi/`) — learning-analytics statements to an LRS when `config.has.lrs()`.
- **Gamification** (`server/gamify.js`) — points/levels/badges; `points` (spendable) vs `pointsEarned` (lifetime, drives level) on the user doc.
- **Community** (`server/routes/community.js`) — official/verified accounts + the "Block Pulse" dashboard.

## Conventions

ESM throughout (`"type": "module"`, `.js` extensions in imports). Async/await over callbacks. Route files in `server/routes/` are thin; data shape and mutation rules live in `server/store/repo.js`. When touching `.claude/skills` `_shared/*` references (storage-invariants, llm-gateway, roles, security-baseline), treat them as the canonical spec for the three invariants above.
