'use strict';
// Fix log in GCS (NOT a local file). On Cloud Run a local file is per-instance and lost on
// restart, which breaks the admin-tab <-> CLI sync the doc promises. GCS + CAS keeps them in sync.
const store = require('../store/gcs');
const KEY = process.env.BUG_FIXLOG_GCS_PATH || 'cache/bugfix/log.json';

async function read() { return (await store.get(KEY)) || { fixed: {}, dismissed: {} }; }
async function markFixed(id, note) {
  return store.mutate(KEY, { fixed: {}, dismissed: {} }, (l) => {
    const log = l || { fixed: {}, dismissed: {} };
    log.fixed = log.fixed || {}; log.fixed[id] = { fixedAt: new Date().toISOString(), note: note || '' };
    return log;
  });
}
async function dismiss(id, reason) {
  return store.mutate(KEY, { fixed: {}, dismissed: {} }, (l) => {
    const log = l || { fixed: {}, dismissed: {} };
    log.dismissed = log.dismissed || {}; log.dismissed[id] = { dismissedAt: new Date().toISOString(), reason: reason || '' };
    return log;
  });
}
async function reset() { return store.set(KEY, { fixed: {}, dismissed: {} }); }
module.exports = { KEY, read, markFixed, dismiss, reset };
