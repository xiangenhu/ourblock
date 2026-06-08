'use strict';
/**
 * @uals/skill-runtime — the shared Node backbone the team-* skills assume exists.
 * CommonJS, full-stack Node. Config comes from .env (see config.js / .env.example).
 *
 * Usage (Express):
 *   const { mount, errorHandler, bug } = require('@uals/skill-runtime');
 *   bug.attachProcessHandlers();          // earliest: process + console capture
 *   mount(app, { help: true, bug: true }); // mounts routers, validates config
 *   // ... your routes ...
 *   app.use(errorHandler);                 // LAST: route-error capture (per the spec)
 */
const config = require('./config');
const store = require('./store/gcs');
const llm = require('./llm/gateway');
const i18n = require('./i18n/hash');
const roles = require('./roles/authz');
const xapi = require('./xapi/client');
const bug = require('./bug/reporter');
const bugFetch = require('./bug/fetch');
const fixlog = require('./bug/fixlog');
const helpRouter = require('./help/routes');
const assistRouter = require('./help/assist');
const llmUsageRouter = require('./llm/routes');
const accounting = require('./llm/accounting');
const llmCache = require('./llm/cache');
const bugRouter = require('./bug/routes');

/**
 * Mount feature routers onto an Express app.
 *   opts.help   (default true)  -> /api/config/help-hover, /api/help/ask, /api/admin/help-analytics
 *   opts.bug    (default true)  -> /server/telemetry/bug-report, /server/telemetry/bug-reports
 *   opts.apiBase (default '/api') · opts.bugBase (default '/server')
 *   opts.validate (default true) -> fail loud now if required env is missing
 */
function mount(app, opts = {}) {
  const { help = true, bug: enableBug = true, cost = true, apiBase = '/api', bugBase = '/server', validate = true } = opts;
  if (validate) { config.requireGcs(); if (help) config.requireLlm(); }
  if (help) { app.use(apiBase, helpRouter()); app.use(apiBase, assistRouter()); }
  if (enableBug) app.use(bugBase, bugRouter());
  if (cost) app.use(apiBase, llmUsageRouter());   // GET /api/admin/llm-usage (Admin-only)
  return app;
}

// Add LAST in the middleware chain (after all routes) so route errors are captured then re-thrown.
const errorHandler = bug.bugReporterMiddleware;

module.exports = {
  mount, errorHandler,
  config, store, i18n, roles, xapi,
  llm: { ...llm, accounting, cache: llmCache },
  bug: { ...bug, ...bugFetch, fixlog },
};
