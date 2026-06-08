'use strict';
/**
 * bug/routes.js — telemetry endpoints (BUG_TRACKING_AND_FIXING.md §5).
 *   POST /telemetry/bug-report  (public submit; client never sees BUG_LRS creds)
 *   GET  /telemetry/bug-reports (Admin-only) -> shared fetchBugs() (dedup + appId + fix-log join)
 */
const express = require('express');
const config = require('../config');
const reporter = require('./reporter');
const { fetchBugs } = require('./fetch');
const { requireAdmin } = require('../roles/authz');

function router() {
  const r = express.Router();

  r.post('/telemetry/bug-report', async (req, res) => {
    const b = req.body || {};
    const out = await reporter.reportError({
      source: b.source || 'client', severity: b.severity || 'error', message: b.message || 'unknown',
      stack: b.stack, component: b.component, route: b.route,
      userEmail: req.user && req.user.email, context: b.context,
    });
    res.json(out);
  });

  r.get('/telemetry/bug-reports', requireAdmin, async (req, res) => {
    try {
      res.json(await fetchBugs({ since: req.query.since || '7d' }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return r;
}
module.exports = router;
