'use strict';
/**
 * bug/reporter.js — server-side bug capture (BUG_TRACKING_AND_FIXING.md §3).
 * Invariants honored:
 *   - NEVER crashes the app: every send is wrapped; failures are silent.
 *   - Console intercept skips '[BugReporter]'-prefixed logs (no infinite loop).
 *   - Silent no-op when BUG_LRS_* env is missing (local dev).
 *   - Long text -> context.extensions, never result.response (project xAPI rule).
 *   - PII: actor is pseudonymized (a reporter identity, not the end-user); redact learner
 *     data from message/context before calling reportError (see team-privacy).
 *   - Fix log lives in GCS (cache/bugfix/log.json), NOT a local file — see bug/triage usage.
 */
const os = require('os');
const crypto = require('crypto');
const config = require('../config');

const PREFIX = '[BugReporter]';
const dedup = new Map(); // key -> expiresAt (1-min TTL)
const DEDUP_TTL = 60 * 1000;

function configured() {
  const b = config().bugLrs;
  return !!(b.endpoint && b.username && b.password);
}
function uuid() { return crypto.randomUUID(); }

function buildStatement({ message, stack, source = 'server', severity = 'error', route, method, statusCode, userEmail, component, context }) {
  const c = config();
  const APP = c.appUrl;
  const appId = c.bugLrs.appId;
  const errorId = uuid();
  const ext = (k, v) => (v == null || v === '' ? null : [`${APP}/${k}`, v]);
  const extensions = Object.fromEntries([
    ext('appId', appId), ext('errorId', errorId), ext('source', source), ext('severity', severity),
    ext('message', String(message).slice(0, 8000)), ext('stack', stack ? String(stack).slice(0, 4000) : null),
    ext('route', route), ext('method', method), ext('statusCode', statusCode),
    ext('userEmail', userEmail), ext('component', component), ext('nodeEnv', c.nodeEnv),
    ext('hostname', os.hostname()), ext('context', context ? JSON.stringify(context).slice(0, 2000) : null),
  ].filter(Boolean));
  return {
    id: errorId, timestamp: new Date().toISOString(),
    actor: { objectType: 'Agent', name: `System Error Reporter [${appId}]`,
             mbox: `mailto:bug-reporter-${appId}@${os.hostname()}` }, // pseudonymized, not the end-user
    verb: { id: 'http://adlnet.gov/expapi/verbs/failed', display: { 'en-US': 'reported error' } },
    object: { objectType: 'Activity', id: `${APP}/errors/${appId}/${source}/${errorId}`,
      definition: { name: { 'en-US': `[${appId}][${severity}] ${String(message).slice(0, 200)}` },
        description: { 'en-US': String(message) }, type: 'http://adlnet.gov/expapi/activities/interaction' } },
    result: { success: false, completion: true }, // NOTE: no result.response by design
    context: { extensions },
  };
}

async function reportError(report = {}) {
  try {
    if (!configured()) return { reported: false, errorId: null };
    const key = `${report.source || 'server'}:${report.message || ''}`;
    const now = Date.now();
    if (dedup.has(key) && dedup.get(key) > now) return { reported: false, errorId: null };
    dedup.set(key, now + DEDUP_TTL);
    const stmt = buildStatement(report);
    const b = config().bugLrs;
    const auth = Buffer.from(`${b.username}:${b.password}`).toString('base64');
    await fetch(`${b.endpoint}/statements`, { method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'X-Experience-API-Version': '1.0.3', 'Content-Type': 'application/json' },
      body: JSON.stringify(stmt) });
    return { reported: true, errorId: stmt.id };
  } catch (_) { return { reported: false, errorId: null }; } // never throw
}

function bugReporterMiddleware(err, req, res, next) {
  reportError({ source: 'server', severity: 'error', message: err && err.message ? err.message : String(err),
    stack: err && err.stack, route: req.originalUrl, method: req.method,
    statusCode: res.statusCode >= 400 ? res.statusCode : 500,
    userEmail: req.user && req.user.email }).catch(() => {});
  next(err);
}

function attachProcessHandlers() {
  process.on('uncaughtException', (e) => { reportError({ source: 'server', severity: 'fatal', message: e.message, stack: e.stack }).catch(() => {}); });
  process.on('unhandledRejection', (e) => { reportError({ source: 'server', severity: 'fatal', message: (e && e.message) || String(e), stack: e && e.stack }).catch(() => {}); });
  for (const level of ['error', 'warn']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try {
        const msg = args.map(String).join(' ');
        if (!msg.startsWith(PREFIX)) reportError({ source: 'server', severity: level === 'warn' ? 'warning' : 'error', message: msg }).catch(() => {});
      } catch (_) {}
      orig(...args);
    };
  }
}

module.exports = { reportError, bugReporterMiddleware, attachProcessHandlers, buildStatement, configured };
