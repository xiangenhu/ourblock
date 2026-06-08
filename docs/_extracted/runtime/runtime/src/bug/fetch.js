'use strict';
// Shared BUG_LRS fetch + parse + dedup + fix-log join. Used by bug/routes.js and scripts/bug-triage.js.
const config = require('../config');
const reporter = require('./reporter');
const fixlog = require('./fixlog');

function sinceToISO(s) {
  if (!s) return new Date(Date.now() - 7 * 864e5).toISOString();
  const m = String(s).match(/^(\d+)(h|d|w)$/);
  if (!m) { const d = new Date(s); return isNaN(d) ? new Date(Date.now() - 7 * 864e5).toISOString() : d.toISOString(); }
  const n = +m[1]; const ms = m[2] === 'h' ? 36e5 : m[2] === 'w' ? 7 * 864e5 : 864e5;
  return new Date(Date.now() - n * ms).toISOString();
}

const SEV_WEIGHT = { fatal: 4, error: 3, warning: 2, info: 1 };
function categorize(b) {
  const s = `${b.message || ''} ${b.route || ''}`.toLowerCase();
  if (/401|403|auth|token|login/.test(s)) return 'Authentication';
  if (/404|not found/.test(s)) return 'Not Found';
  if (/429|rate.?limit/.test(s)) return 'Rate Limiting';
  if (/gcs|storage|bucket/.test(s)) return 'Storage/GCS';
  if (/lrs|xapi|statement/.test(s)) return 'xAPI/LRS';
  if (/llm|openai|gateway|token limit/.test(s)) return 'LLM/AI';
  if (/i18n|translat|locale/.test(s)) return 'i18n';
  if (/parse|json|unexpected/.test(s)) return 'Data Parsing';
  if (/5\d\d|server error|internal/.test(s)) return 'Server Error';
  if (b.source === 'client') return 'Client Console';
  return 'Other';
}

async function fetchBugs({ since = '7d' } = {}) {
  const c = config();
  if (!reporter.configured()) return { configured: false, bugs: [], summary: {} };
  const b = c.bugLrs;
  const sinceISO = sinceToISO(since);
  const auth = Buffer.from(`${b.username}:${b.password}`).toString('base64');
  const url = `${b.endpoint}/statements?since=${encodeURIComponent(sinceISO)}&limit=2000`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, 'X-Experience-API-Version': '1.0.3' } });
  const data = await res.json().catch(() => ({ statements: [] }));
  const APP = c.appUrl, appId = b.appId;
  const ex = (s, k) => s.context && s.context.extensions && s.context.extensions[`${APP}/${k}`];
  const parsed = (data.statements || [])
    .filter((s) => ex(s, 'appId') === appId)
    .map((s) => ({ errorId: ex(s, 'errorId'), source: ex(s, 'source'), severity: ex(s, 'severity') || 'error',
      message: ex(s, 'message'), stack: ex(s, 'stack'), route: ex(s, 'route'),
      statusCode: ex(s, 'statusCode'), component: ex(s, 'component'), timestamp: s.timestamp }));
  const map = new Map();
  for (const p of parsed) {
    const k = `${p.source}:${p.message}:${p.route}:${p.statusCode}`;
    const cur = map.get(k);
    if (cur) { cur.occurrences++; cur.lastSeen = p.timestamp; }
    else map.set(k, { ...p, occurrences: 1, firstSeen: p.timestamp, lastSeen: p.timestamp });
  }
  const log = await fixlog.read();
  const bugs = [...map.values()].map((x) => {
    const status = log.fixed[x.errorId] ? 'fixed' : log.dismissed[x.errorId] ? 'dismissed' : 'open';
    const score = (SEV_WEIGHT[x.severity] || 1) * Math.min(x.occurrences, 10);
    return { ...x, category: categorize(x), score, status,
      fixNote: (log.fixed[x.errorId] || {}).note || (log.dismissed[x.errorId] || {}).reason || '' };
  }).sort((a, b2) => b2.score - a.score);
  const summary = { appId, total: parsed.length, unique: bugs.length,
    open: bugs.filter((x) => x.status === 'open').length,
    fixed: bugs.filter((x) => x.status === 'fixed').length,
    dismissed: bugs.filter((x) => x.status === 'dismissed').length,
    bySeverity: bugs.reduce((a, x) => ((a[x.severity] = (a[x.severity] || 0) + 1), a), {}),
    bySource: bugs.reduce((a, x) => ((a[x.source] = (a[x.source] || 0) + 1), a), {}) };
  return { configured: true, since: sinceISO, bugs, summary };
}

module.exports = { fetchBugs, sinceToISO, categorize, SEV_WEIGHT };
