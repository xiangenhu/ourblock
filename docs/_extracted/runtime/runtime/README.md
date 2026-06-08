# @uals/skill-runtime

The shared Node.js backbone the `team-*` Claude Code skills assume exists. Without it the skills
keep saying "route through the shared GCS client / the unified gateway / the xAPI client" with
nothing behind those words. CommonJS, full-stack Node. **All config comes from `.env`** (see
`.env.example`).

## What's inside (maps to the skills)

| Module | Skill it backs | Invariant it enforces |
|--------|----------------|------------------------|
| `src/config.js` | all | one env contract; required vars fail loud |
| `src/store/gcs.js` | team-gcs, team-cache, storage-invariants | **GCS-only persistence**; CAS via `ifGenerationMatch` |
| `src/llm/gateway.js` | team-content, team-help | **unified gateway** for ALL calls; injects the language directive |
| `src/llm/accounting.js` + `/api/admin/llm-usage` | team-cost | **per-user token accounting** for cost; cache hits = ~0 |
| `src/roles/authz.js` | roles, team-security, team-privacy | **Admin/Educator/Learner**; deny-by-default + resource-level |
| `src/xapi/client.js` | team-xapi | **targeted queries only**; verb taxonomy, no fallback |
| `src/i18n/hash.js` | team-i18n | **hash-based**; registry in GCS |
| `src/help/*` + `public/contextual-help.js` | team-help | help cache in GCS; admin analytics Admin-only |
| `src/bug/*` + `scripts/bug-triage.js` | team-bugfix | **fix log in GCS** (not a local file); BUG_LRS separate; pseudonymized actor |

## Install the runtime
```bash
npm install        # pulls @google-cloud/storage, express, cookie-parser
cp .env.example .env && edit .env
```

## Wire it into your Express app
```js
const express = require('express');
const cookieParser = require('cookie-parser');
const { mount, errorHandler, bug } = require('@uals/skill-runtime');

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

bug.attachProcessHandlers();              // EARLIEST — process + console capture
mount(app, { help: true, bug: true, cost: true }); // /api/help/*, /server/telemetry/*, /api/admin/llm-usage

// ... your application routes ...

app.use(errorHandler);                    // LAST — route-error capture (per the spec)
app.listen(process.env.PORT || 3000);
```
Add the help client to each page: `<script src="/contextual-help.js?v=1"></script>`
(serve `public/`), and set its `CFG.appSlug` to match `APP_SLUG`.

> **Auth contract.** `roles/authz.js` reads `req.user = { id, role, email, classIds? }`. Populate
> it from your OAuth/XGH gateway middleware before `mount()`. Admin-only endpoints depend on it.

## Install the *skills* (the .claude/* files)
```bash
node install.js /path/to/project        # copies commands + _shared + agents into .claude/
# or: npx uals-install-skills /path/to/project
```

## Triage bugs
```bash
npm run debugging                        # interactive
node scripts/bug-triage.js --since 24h   # CI/agent: writes bug-triage-report.md (read by /team-bugfix)
```

## Notes / deliberate boundaries
- `mount({ validate: true })` fails loud if `GCS_BUCKET_NAME` (and, for help, the LLM key) is missing.
- TTS (`/api/tts`) is **not** mounted by default; wire it from the spec (`CONTEXT_HELP.md §11.4`) if needed — it's the one piece with a hard provider dependency.
- The GCS store uses object **generation preconditions** for CAS (production-correct equivalent of the spec's `if-generation-match: 0|N`).
- Swap `llm/gateway.js`'s body to target your XGH gateway; the `callLLM({system,user})` signature is the contract everything else depends on.
