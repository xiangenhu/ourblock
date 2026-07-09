# bugfix-kit — installable bug-tracking runtime

Packages this repo's **self-contained bug-tracking pipeline** so it can be dropped into another
app. Errors anywhere (client React tree, Express server, background processes) are captured,
forwarded to a dedicated xAPI Learning Record Store (**BUG_LRS**) as statements with verb
`http://adlnet.gov/expapi/verbs/failed`, and surfaced through an admin dashboard feed and a CLI
triage tool.

This README is the **install/packaging layer**. The canonical behavioral spec is
`@.claude/commands/_shared/BUG_TRACKING_AND_FIXING.md` — read it for the full pipeline design,
data captured per error, categorization, and severity scoring. The `/team-bugfix` skill consumes
the same LRS to triage and auto-fix.

## What it installs

| Group (`--<id>-dir`) | Source | Default dest | File |
|---|---|---|---|
| `client` | `runtime/client` | `client/src/utils` | `bugReporter.js` — browser error capture + batched POST |
| `server` | `runtime/server` | `server/services` | `bugReporter.js` — **self-contained** server capture (reportError, middleware, process handlers) |
| `routes` | `runtime/server` | `server/routes` | `bugReportRoutes.js` — `createBugReportRoutes(deps)` factory (extracted from telemetry.js) |
| `scripts` | `runtime/scripts` | `scripts` | `bug-triage.js` — interactive + CI CLI triage tool |

All four files are self-contained: `client/bugReporter.js` (browser globals only), `bug-triage.js`
(`dotenv` + `fetch`), `bugReportRoutes.js` (Express + injected deps), and `server/bugReporter.js`
(Node 18+ `fetch`/`crypto` + `BUG_LRS_*` env — **no vendored backbone to supply**).

## Quick start

```bash
# from the source repo, install into a target app
node .claude/commands/_shared/kits/install.mjs bugfix --app <dir> [--dry-run] [--force]

# or run this kit's shim directly
node .claude/commands/_shared/bugfix-kit/install.mjs --app <dir>
```

Per-group dest overrides: `--client-dir`, `--server-dir`, `--routes-dir`, `--scripts-dir`.
The installer copies files and prints the manual wiring; it never edits your source.

## Integration contract

### 1. Environment variables (the only config)

| Var | Required | Purpose |
|---|---|---|
| `BUG_LRS_ENDPOINT` | yes | LRS base URL; statements POST to `${endpoint}/statements` |
| `BUG_LRS_USERNAME` | yes | LRS Basic-auth user |
| `BUG_LRS_PASSWORD` | yes | LRS Basic-auth password |
| `BUG_APP_ID` | no (default `default`) | **Isolates this app's bugs** in a shared LRS; both writer and readers filter on it |
| `APP_URL` | no (default `https://alwaysai.skoonline.org`) | Base IRI for xAPI `context.extensions` keys (`${APP_URL}/message`, `/stack`, `/appId`, …) |

`BUG_APP_ID` and `APP_URL` **must match** across the server writer, the GET reader
(`bugReportRoutes.js`), and `scripts/bug-triage.js`, or the reader/CLI will filter out the
statements the writer produced.

### 2. Client wiring — `client/src/main.jsx`

```js
import { initBugReporter } from './utils/bugReporter';
initBugReporter(); // once at startup
```

`initBugReporter()` installs listeners for `window.error`, `unhandledrejection`, and intercepts
`console.error`/`console.warn`. Reports are deduped (1-min TTL), batched every 3s (max 20 queued),
and flushed via `sendBeacon` on page hide. It POSTs to a fixed `ENDPOINT =
'/server/telemetry/bug-report'` (top of the file — change there if you mount the route elsewhere),
attaching `Authorization: Bearer <auth_token from localStorage>` when present. Manual reports:
`reportError({ message, component, severity, context })` / `reportCaughtError(err, component)`.

### 3. Server reporter (self-contained — no backbone needed)

In the source app `server/services/bugReporter.js` is a thin adapter over a vendored
`@uals/skill-runtime` backbone. **This kit ships a standalone version instead**: the same public API
and behavior, but the backbone's only real dependency (a few env values) is inlined, so it drops in
with no extra runtime to vendor. Requires Node 18+ (global `fetch`, `crypto.randomUUID`).

Public API (what the routes, middleware, and process handlers call):

| Fn | Contract |
|---|---|
| `isConfigured()` | `true` iff `BUG_LRS_ENDPOINT/USERNAME/PASSWORD` are all set |
| `reportError(report) → Promise<{reported, errorId}>` | builds an xAPI `failed` statement, dedups, POSTs to BUG_LRS; **never throws** |
| `bugReporterMiddleware(err, req, res, next)` | 4-arg Express error middleware; reports then `next(err)` |
| `attachProcessHandlers()` | wires `uncaughtException` / `unhandledRejection` + console capture; **no-op if unconfigured** |

It builds the statement with: `verb.id =
http://adlnet.gov/expapi/verbs/failed`, a pseudonymized reporter `actor` (not the end-user),
`result: { success:false, completion:true }`, and — critically — **all long text (message, stack,
context) in `context.extensions`, never `result.response`** (project xAPI rule; `result.response`
is size-limited/truncated by LRS implementations). Statements are tagged with `${APP_URL}/appId =
BUG_APP_ID`.

### 4. Server wiring — `server.js`

```js
const { bugReporterMiddleware, attachProcessHandlers } = require('./services/bugReporter');
const { createBugReportRoutes } = require('./routes/bugReportRoutes');

attachProcessHandlers();                       // process-level + console capture

// ...register all your routes...

app.use('/server/telemetry', createBugReportRoutes({
  bugReporter: require('./services/bugReporter'),
  optionalAuth,      // your middleware: populate req.user if token present, don't 401 when absent
  requireAdmin,      // your middleware: 401/403 non-admins
  // fixLogPath: path.resolve(__dirname, '..', 'bug-fix-log.json'),  // optional; defaults to cwd/bug-fix-log.json
}));

app.use(bugReporterMiddleware);                // Express error middleware — mount LAST, after all routes
```

`createBugReportRoutes(deps)` returns a router exposing:

- **`POST /bug-report`** (`optionalAuth`) — the client endpoint. `503` if bug reporting isn't
  configured; `400` without a `message`; otherwise forwards `{source:'client', severity, message,
  stack, component, route, userEmail: req.user?.email, context}` to `bugReporter.reportError`.
- **`GET /bug-reports`** (`requireAdmin`) — admin dashboard feed. Reads `BUG_LRS_*` env directly,
  paginates all statements since `?since=` (ISO or `7d`/`24h`/`2w` shorthand, default `7d`), filters
  to `BUG_APP_ID`, dedups, annotates each with `open`/`fixed`/`dismissed` from the fix log, and
  returns `{ configured, bugs, summary, since }`.

`bugReportRoutes.js` also documents a paste-in alternative if you'd rather fold the two handlers
into an existing telemetry router than mount a sub-router. Requires Node 18+ (global `fetch`).

### 5. package.json scripts

```json
{ "scripts": { "bugs": "node scripts/bug-triage.js", "debugging": "node scripts/bug-triage.js" } }
```

### 6. (Optional) Admin dashboard tab

Add a "Bug Reports" tab that `GET`s `/server/telemetry/bug-reports?range=7d` and renders the
`summary` (totals, severity/source breakdown, open/fixed/dismissed) plus an expandable list with
stack traces. (This kit does not ship a React tab component — see the source app's
`client/src/pages/AdminDashboard.jsx` for a reference implementation.)

## CLI triage tool (`scripts/bug-triage.js`)

Loads `.env` from the app root, fetches from BUG_LRS, dedups, categorizes, scores by severity, and
persists triage state to `bug-fix-log.json` (fixed/dismissed IDs) + `bug-triage-report.md`.

```bash
npm run debugging                                   # interactive menu
node scripts/bug-triage.js                          # same
node scripts/bug-triage.js --since 24h              # non-interactive: fetch + write report
node scripts/bug-triage.js --mark-fixed <errorId> "note"
node scripts/bug-triage.js --dismiss   <errorId> "reason"
node scripts/bug-triage.js --reset                  # clear fix log
```

The GET route and the CLI share the same `bug-fix-log.json` (repo root by default), so a bug marked
fixed via CLI shows as `fixed` in the dashboard feed.

## Hard invariants (do not violate)

- **Silent no-op without creds.** When `BUG_LRS_ENDPOINT/USERNAME/PASSWORD` are absent, the client
  posts land on a `503`, the server `reportError`/`attachProcessHandlers` no-op, and the CLI prints a
  config hint. Bug tracking is simply inactive in local dev — never a crash.
- **Never crash the app.** Every send path is wrapped; capture failures are swallowed. The console
  interceptors skip their own `[BugReporter]`-prefixed logs to avoid infinite loops.
- **`BUG_APP_ID` isolates apps** sharing one LRS. Keep it identical across writer, reader, and CLI.
- **Long text → `context.extensions`, never `result.response`** (truncation-safe; project xAPI rule).
- **Actor is pseudonymized** (a reporter identity), not the end-user; redact learner PII from
  `message`/`context` before reporting.

## Verify

```bash
# syntax-check the copied/created server + script files
node --check runtime/server/bugReporter.js
node --check runtime/server/bugReportRoutes.js
node --check runtime/scripts/bug-triage.js

# dry run, then real install into a throwaway app dir
node .claude/commands/_shared/kits/install.mjs bugfix --app /tmp/bugtest --dry-run
node .claude/commands/_shared/kits/install.mjs bugfix --app /tmp/bugtest
```

Then in the target app: set `BUG_LRS_*` env, wire per steps 2–5, trigger an error, and confirm a
`failed` statement appears in the LRS (or via `npm run debugging`). With creds unset, confirm the
app runs normally and reporting stays inactive.

**Canonical spec:** `@.claude/commands/_shared/BUG_TRACKING_AND_FIXING.md`.
