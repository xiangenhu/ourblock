# Bug Tracking & Fixing — End-to-End Implementation

This document describes the self-contained bug tracking and AI-assisted fix
pipeline used by AlwaysAI. The system captures errors anywhere in the
application (client React, server Express, background processes), forwards them
to a dedicated xAPI Learning Record Store (BUG_LRS), and exposes them through
three surfaces: an admin dashboard tab, a CLI triage tool, and a Claude Code
skill (`/team-bugfix`) that fixes them automatically.

---

## 1. Pipeline Overview

```
┌────────────────────────┐      ┌────────────────────────┐
│  Client React tree     │      │  Express server         │
│  - window.error        │      │  - error middleware     │
│  - unhandledrejection  │      │  - uncaughtException    │
│  - console.error/warn  │      │  - unhandledRejection   │
│  - BugErrorBoundary    │      │  - console.error/warn   │
│  - reportError() (API) │      │  - reportError() (API)  │
└──────────┬─────────────┘      └──────────┬──────────────┘
           │ batched POST                    │ direct xAPI POST
           │ /server/telemetry/bug-report    │
           ▼                                 ▼
┌──────────────────────────────────────────────────────────┐
│  server/services/bugReporter.js                          │
│  - dedup (1-minute TTL)                                  │
│  - build xAPI statement (verb: failed)                   │
│  - tag with BUG_APP_ID                                   │
│  - POST to BUG_LRS_ENDPOINT/statements                   │
└──────────────────────────┬───────────────────────────────┘
                           ▼
              ┌──────────────────────────┐
              │  BUG_LRS (xAPI store)    │
              │  Basic auth, multi-app   │
              └────────────┬─────────────┘
                           │
       ┌───────────────────┼─────────────────────┐
       ▼                   ▼                     ▼
┌─────────────┐   ┌─────────────────┐   ┌────────────────────┐
│ Admin tab   │   │ scripts/bug-    │   │ /team-bugfix       │
│ (dashboard) │   │ triage.js CLI   │   │ (Claude Code)      │
└─────────────┘   └─────────────────┘   └────────────────────┘
```

Three guarantees hold throughout:

1. **The bug reporter never crashes the app.** Every send is wrapped in
   try/catch with empty handlers. Failure to report is silent.
2. **Reporter logs are filtered out of interception.** Both client and server
   intercept `console.error`/`console.warn`, but skip messages prefixed with
   `[BugReporter]` to avoid infinite loops.
3. **No credentials in payloads.** The client never sees BUG_LRS credentials;
   it talks to its own server, which holds the basic-auth secret.

---

## 2. Client Capture (`client/src/utils/bugReporter.js`)

### What is captured

| Source | Mechanism |
|--------|-----------|
| Global JS errors | `window.addEventListener('error', ...)` |
| Promise rejections | `window.addEventListener('unhandledrejection', ...)` |
| Logged errors | Intercepted `console.error` / `console.warn` |
| React render crashes | `BugErrorBoundary` (componentDidCatch) |
| API 4xx/5xx | `client/src/utils/api.js` calls `reportError` on non-401/403 |
| Manual reports | `reportError({...})`, `reportCaughtError(err, component)` |

### Batching & dedup

- **Queue**: max 20 reports; further reports dropped if over.
- **Dedup**: 1-minute TTL by `${source}:${message}` key.
- **Flush interval**: every 3 seconds while the page is open.
- **On page hide / unload**: uses `navigator.sendBeacon` (survives navigation)
  via both `pagehide` and `visibilitychange→hidden`. The previous
  `beforeunload + fetch` approach lost reports on tab close, especially on
  mobile where `beforeunload` does not fire.

### Transport

```
POST /server/telemetry/bug-report
Authorization: Bearer <auth_token> (if logged in)
Content-Type: application/json

{
  message, stack?, component?, route, severity,
  context: { userAgent, url, timestamp, ...extras }
}
```

### Error Boundary

`client/src/components/BugErrorBoundary.jsx` wraps the entire `<App>` tree
in `main.jsx`. On render error it:

1. Extracts the component name from React's `componentStack`.
2. Calls `reportCaughtError(error, component, { componentStack })`.
3. Renders a minimal fallback UI with a Reload button.

This catches what `window.error` misses: errors thrown during render that
React would otherwise unmount the whole tree for without surfacing them as
window errors.

---

## 3. Server Capture (`server/services/bugReporter.js`)

### What is captured

| Source | Mechanism |
|--------|-----------|
| Express route errors | `bugReporterMiddleware` (attached after all routes) |
| Process exceptions | `process.on('uncaughtException', ...)` |
| Promise rejections | `process.on('unhandledRejection', ...)` |
| Logged errors | Intercepted `console.error` / `console.warn` |
| Manual reports | `require('./services/bugReporter').reportError({...})` |

Wiring in `server/server.js`:

```js
const bugReporter = require('./services/bugReporter');
bugReporter.attachProcessHandlers();   // line ~72: process handlers + console
// ... all routes ...
app.use(bugReporter.bugReporterMiddleware); // line ~284: route error middleware
```

### xAPI statement shape

Every error becomes an xAPI statement posted to `${BUG_LRS_ENDPOINT}/statements`:

```js
{
  id: <UUID>,
  timestamp: <ISO>,
  actor: {
    objectType: 'Agent',
    name: 'System Error Reporter [<BUG_APP_ID>]',
    mbox: 'mailto:bug-reporter-<BUG_APP_ID>@<host>'
  },
  verb: {
    id: 'http://adlnet.gov/expapi/verbs/failed',
    display: { 'en-US': 'reported error' }
  },
  object: {
    objectType: 'Activity',
    id: '<APP_URL>/errors/<BUG_APP_ID>/<source>/<errorId>',
    definition: {
      name: { 'en-US': '[<BUG_APP_ID>][<SEVERITY>] <first 200 chars of message>' },
      description: { 'en-US': <message> },
      type: 'http://adlnet.gov/expapi/activities/interaction'
    }
  },
  result: { success: false, completion: true },
  context: {
    extensions: {
      '<APP_URL>/appId':      <BUG_APP_ID>,
      '<APP_URL>/errorId':    <UUID>,
      '<APP_URL>/source':     'server' | 'client',
      '<APP_URL>/severity':   'fatal' | 'error' | 'warning' | 'info',
      '<APP_URL>/message':    <full message>,
      '<APP_URL>/stack':      <stack, max 4000 chars>,
      '<APP_URL>/route':      <route or path>,
      '<APP_URL>/method':     <HTTP method>,
      '<APP_URL>/statusCode': <HTTP status>,
      '<APP_URL>/userEmail':  <authenticated user email>,
      '<APP_URL>/component':  <React component name>,
      '<APP_URL>/nodeEnv':    <NODE_ENV>,
      '<APP_URL>/hostname':   <os.hostname()>,
      '<APP_URL>/context':    <JSON.stringify, max 2000 chars>
    }
  }
}
```

**Note on `result.response`**: per the project's xAPI rule (CLAUDE.md), long
text data goes into `context.extensions`, never into `result.response`. The
implementation deliberately omits `result.response`; the full message lives in
`context.extensions["<APP_URL>/message"]`.

### Multi-app isolation

`BUG_APP_ID` (default `default`) lets several apps share one BUG_LRS. Every
statement carries the appId in `context.extensions['<APP_URL>/appId']` and in
the activity name prefix. All downstream readers (admin endpoint, CLI, skill)
filter by appId before doing anything else.

---

## 4. Storage Path

```
POST <BUG_LRS_ENDPOINT>/statements
  Authorization: Basic <base64(USERNAME:PASSWORD)>
  X-Experience-API-Version: 1.0.3
```

The bug reporter silently no-ops if any of `BUG_LRS_ENDPOINT`,
`BUG_LRS_USERNAME`, `BUG_LRS_PASSWORD` is missing — local dev runs without
generating noise.

---

## 5. Read API (`server/routes/telemetry.js`)

### `POST /server/telemetry/bug-report`

Client submission endpoint. Accepts a single report and forwards it to BUG_LRS
via `bugReporter.reportError`. Returns `{ reported: boolean, errorId: string }`.

### `GET /server/telemetry/bug-reports?since=7d`

Admin-only. Pulls all xAPI statements from BUG_LRS, filters by `appId`,
deduplicates by `${source}:${message}:${route}:${statusCode}`, joins against
the local fix log, and returns:

```json
{
  "configured": true,
  "since": "<ISO>",
  "bugs": [ { ...parsed, occurrences, firstSeen, lastSeen, status, fixNote } ],
  "summary": {
    "appId", "total", "unique",
    "open", "fixed", "dismissed",
    "bySeverity": { "fatal": N, "error": N, "warning": N, "info": N },
    "bySource":   { "server": N, "client": N }
  }
}
```

`since` accepts shorthand: `1h`, `24h`, `7d`, `30d`, `90d`, `2w`, or ISO.

---

## 6. Admin Dashboard Tab

`client/src/pages/AdminDashboard.jsx` exposes a "Bug Reports" tab:

- Time-range selector (1h / 24h / 7d / 30d / 90d)
- Status filter (Open / Fixed / Dismissed / All)
- Summary cards: total, unique, open, fixed, dismissed; breakdown by severity
  and by source
- Expandable list per bug: severity icon, message, occurrences, route, user,
  full stack trace, and triage status

The tab calls `GET /server/telemetry/bug-reports` and is gated by the same
`requireAdmin` middleware as the endpoint.

---

## 7. CLI Triage (`scripts/bug-triage.js`)

```bash
npm run debugging              # interactive menu
node scripts/bug-triage.js     # same
```

### Interactive menu

| Key | Action |
|-----|--------|
| 1 | Fetch & show all bugs from the last 7 days |
| 2 | Fetch with custom range (`1h`, `6h`, `24h`, `3d`, `7d`, `2w`) |
| 3 | View open bugs grouped by category, sorted by severity score |
| 4 | View bug detail (full stack, context, proposed fix) |
| 5 | Mark a bug as fixed (or `all`) with a note |
| 6 | Dismiss a bug with a reason |
| 7 | Generate full Markdown report → `bug-triage-report.md` |
| 8 | View fix log |
| 9 | Reset fix log |
| 0 | Exit |

### Non-interactive (CI / agents)

```bash
node scripts/bug-triage.js --since 24h          # fetch + generate report
node scripts/bug-triage.js --mark-fixed <id> "fixed auth check"
node scripts/bug-triage.js --dismiss   <id> "transient GCS 429"
node scripts/bug-triage.js --reset
```

The non-interactive `--since` form always writes `bug-triage-report.md` and
prints a list to stdout — suitable for piping into a chat or commit message.

### Categorization

The CLI auto-categorizes by message and route content. Current buckets:
Authentication, Not Found, Rate Limiting, Server Error, Storage/GCS, xAPI/LRS,
LLM/AI, Assessment, i18n, Voice/WebSocket, Learning, Data Parsing, Client
Console, Payload Size, Other.

### Severity scoring

`score = severityWeight × min(occurrences, 10)` where `fatal=4, error=3,
warning=2, info=1`. Categories with higher total score appear first, and
within a category bugs are ordered by score. This pushes the loudest, most
severe issues to the top.

### Fix log

`bug-fix-log.json` (gitignored) tracks `{ fixed: { id: {fixedAt, note} },
dismissed: { id: {dismissedAt, reason} } }`. Both the admin endpoint and the
CLI read it; marking via either surface affects both.

---

## 8. Claude Code Skill (`/team-bugfix`)

`.claude/commands/team-bugfix.md` automates the full read → fix → close cycle.

### Phases

1. **Fetch**: prefers `node scripts/bug-triage.js --since <range>` so dedup,
   appId filtering, and categorization happen in one place.
2. **Parse the generated report** (`bug-triage-report.md`) instead of raw
   xAPI; this is the canonical machine-readable view.
3. **Filter** by `$ARGUMENTS` (`errors`, `client`, `server`, or a keyword like
   `quiz`).
4. **Investigate in parallel** using subagents — one per unique bug.
5. **Fix sequentially**, reading each file before editing.
6. **Close the loop**: for each fix, call
   `node scripts/bug-triage.js --mark-fixed <errorId> "<note>"` so the bug
   drops off open lists.
7. **Report**: print Fixed / Skipped / Needs-manual table and list of changed
   files.

The skill never commits — humans control commits.

---

## 9. Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `BUG_LRS_ENDPOINT` | yes | xAPI statements endpoint |
| `BUG_LRS_USERNAME` | yes | Basic auth username |
| `BUG_LRS_PASSWORD` | yes | Basic auth password |
| `BUG_APP_ID` | recommended | Multi-app namespace (default `default`) |
| `APP_URL` | recommended | Used as the xAPI extension key prefix |
| `NODE_ENV` | optional | Captured in each statement for env filtering |

If any of the first three is missing, bug reporting **silently no-ops** — no
errors, no warnings, no LRS calls. This is intentional so local dev works
without setup.

---

## 10. Operational Playbook

### After a deploy
1. `npm run debugging` → option 2 → range `1h`. Look for new categories or
   spikes.
2. If new bugs appear, run `/team-bugfix` with a focused filter.
3. Verify by reloading the affected page or replaying the failing route.

### When investigating a single bug
1. Admin dashboard → Bug Reports → expand the bug. Copy the `errorId`.
2. `node scripts/bug-triage.js` → option 4 → paste the id. Read the proposed
   fix.
3. If you fix it, option 5 (or `--mark-fixed <id>`) to close it out.

### When the noise floor rises
1. Open `bug-triage-report.md` (option 7) and skim the "Other" and "Client
   Console" sections — these are usually where unhelpful logs accumulate.
2. Dismiss with a reason if they're not bugs (e.g., third-party widget
   warnings).

---

## 11. Files Touched

| File | Purpose |
|------|---------|
| `client/src/utils/bugReporter.js` | Client capture, dedup, batch, sendBeacon flush |
| `client/src/components/BugErrorBoundary.jsx` | React render-error catcher |
| `client/src/main.jsx` | Boundary wired in at the root |
| `client/src/utils/api.js` | API helper auto-reports 4xx/5xx (skip 401/403) |
| `server/services/bugReporter.js` | Server capture, xAPI statement build, LRS POST |
| `server/routes/telemetry.js` | `POST /bug-report`, `GET /bug-reports` |
| `server/server.js` | `attachProcessHandlers()` + `bugReporterMiddleware` |
| `client/src/pages/AdminDashboard.jsx` | Admin Bug Reports tab |
| `scripts/bug-triage.js` | Interactive + non-interactive triage CLI |
| `bug-fix-log.json` | Persistent fixed/dismissed status (gitignored) |
| `bug-triage-report.md` | Generated Markdown report (gitignored) |
| `.claude/commands/team-bugfix.md` | Claude Code automation skill |
