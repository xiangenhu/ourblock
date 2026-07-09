/**
 * Bug-report Express routes — extracted, self-contained snippet.
 *
 * These two handlers live inside AlwaysAI's larger `server/routes/telemetry.js`.
 * They are extracted here VERBATIM (behavior-preserving) so an installing app can
 * mount them without dragging along the rest of the telemetry route. Two ways to use:
 *
 *   A) Mount as its own sub-router (simplest):
 *        const { createBugReportRoutes } = require('./bugReportRoutes');
 *        app.use('/server/telemetry', createBugReportRoutes({
 *          bugReporter: require('../services/bugReporter'),
 *          optionalAuth, requireAdmin,           // your auth middleware
 *        }));
 *      → exposes POST /server/telemetry/bug-report and GET /server/telemetry/bug-reports
 *
 *   B) Paste the two `router.<verb>(...)` blocks below into an existing telemetry
 *      router. Keep the client endpoint path (`/bug-report`) in sync with the client
 *      reporter (`client/src/utils/bugReporter.js` → ENDPOINT).
 *
 * Dependencies (the integration contract — pass via `deps`):
 *   - bugReporter:   the server bug-report service (this kit's server/bugReporter.js).
 *                    Must expose `isConfigured()` and `reportError({...}) → errorId`.
 *   - optionalAuth:  middleware that populates `req.user` if a token is present,
 *                    but does not 401 when absent (public POST path).
 *   - requireAdmin:  middleware that 401/403s non-admins (protects the GET dashboard feed).
 *   - fixLogPath:    (optional) absolute path to `bug-fix-log.json`. Defaults to
 *                    `<cwd>/bug-fix-log.json`. In the source app this file lives at the
 *                    repo root and is shared with `scripts/bug-triage.js`.
 *
 * Env read directly by the GET handler (see README integration contract):
 *   BUG_LRS_ENDPOINT, BUG_LRS_USERNAME, BUG_LRS_PASSWORD  — LRS connection (Basic auth)
 *   BUG_APP_ID (default 'default')                        — isolates this app's bugs
 *   APP_URL (default 'https://alwaysai.skoonline.org')    — xAPI extension IRI base
 *
 * Requires Node 18+ (global `fetch`).
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

function createBugReportRoutes(deps = {}) {
  const {
    bugReporter,
    optionalAuth = (req, _res, next) => next(),
    requireAdmin = (req, res, next) => next(),
    fixLogPath = path.resolve(process.cwd(), 'bug-fix-log.json'),
  } = deps;

  if (!bugReporter) {
    throw new Error('createBugReportRoutes: `bugReporter` service is required in deps');
  }

  const router = express.Router();

  /**
   * POST /bug-report
   * Receive error reports from the frontend and forward to BUG_LRS.
   * Public path (optionalAuth) so unauthenticated client errors are still captured;
   * `req.user?.email` is attached when a token is present.
   */
  router.post('/bug-report', optionalAuth, async (req, res) => {
    try {
      if (!bugReporter.isConfigured()) {
        return res.status(503).json({ error: 'Bug reporting not configured' });
      }

      const { message, stack, component, route, severity, context } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }

      const errorId = await bugReporter.reportError({
        source: 'client',
        severity: severity || 'error',
        message,
        stack,
        component,
        route,
        userEmail: req.user?.email,
        context
      });

      res.json({ reported: !!errorId, errorId });
    } catch (err) {
      console.error('[Telemetry] Bug report failed:', err.message);
      res.status(500).json({ error: 'Failed to submit bug report' });
    }
  });

  /**
   * GET /bug-reports
   * Fetch bug reports from BUG_LRS for the admin dashboard.
   * Query params: since (ISO string or shorthand like 7d, 24h, 2w).
   * Admin-only (requireAdmin).
   */
  router.get('/bug-reports', requireAdmin, async (req, res) => {
    try {
      const endpoint = process.env.BUG_LRS_ENDPOINT;
      const username = process.env.BUG_LRS_USERNAME;
      const password = process.env.BUG_LRS_PASSWORD;

      if (!endpoint || !username || !password) {
        return res.json({ configured: false, bugs: [], summary: {} });
      }

      // Parse since param
      let since;
      const sinceParam = req.query.since || '7d';
      const match = sinceParam.match(/^(\d+)(h|d|w)$/);
      if (match) {
        const ms = { h: 3600000, d: 86400000, w: 604800000 }[match[2]];
        since = new Date(Date.now() - parseInt(match[1]) * ms).toISOString();
      } else {
        since = sinceParam;
      }

      const auth = Buffer.from(`${username}:${password}`).toString('base64');
      const extBase = process.env.APP_URL || 'https://alwaysai.skoonline.org';
      const appId = process.env.BUG_APP_ID || 'default';

      // Fetch all statements with pagination
      const allStatements = [];
      let url = `${endpoint}/statements?limit=100&ascending=false&since=${since}`;

      while (url) {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Basic ${auth}`,
            'X-Experience-API-Version': '1.0.3'
          }
        });

        if (!response.ok) {
          return res.status(502).json({ error: `LRS returned ${response.status}` });
        }

        const data = await response.json();
        allStatements.push(...(data.statements || []));

        if (data.more) {
          url = data.more.startsWith('http') ? data.more : `${endpoint}${data.more}`;
        } else {
          url = null;
        }
      }

      // Filter statements to only this app's bugs
      const appStatements = allStatements.filter(stmt => {
        const ext = stmt.context?.extensions || {};
        const stmtAppId = ext[`${extBase}/appId`];
        return stmtAppId === appId;
      });

      // Parse statements
      const bugs = appStatements.map(stmt => {
        const ext = stmt.context?.extensions || {};
        return {
          id: stmt.id,
          timestamp: stmt.timestamp,
          appId: ext[`${extBase}/appId`] || 'unknown',
          source: ext[`${extBase}/source`] || 'unknown',
          severity: ext[`${extBase}/severity`] || 'unknown',
          message: ext[`${extBase}/message`] || stmt.result?.response || stmt.object?.definition?.description?.['en-US'] || 'No message',
          stack: ext[`${extBase}/stack`] || null,
          route: ext[`${extBase}/route`] || null,
          method: ext[`${extBase}/method`] || null,
          statusCode: ext[`${extBase}/statusCode`] || null,
          userEmail: ext[`${extBase}/userEmail`] || null,
          component: ext[`${extBase}/component`] || null,
          nodeEnv: ext[`${extBase}/nodeEnv`] || null,
          hostname: ext[`${extBase}/hostname`] || null
        };
      });

      // Deduplicate
      const groups = new Map();
      for (const bug of bugs) {
        const key = `${bug.source}:${bug.message}:${bug.route || ''}:${bug.statusCode || ''}`;
        if (!groups.has(key)) {
          groups.set(key, { ...bug, occurrences: 1, firstSeen: bug.timestamp, lastSeen: bug.timestamp });
        } else {
          const existing = groups.get(key);
          existing.occurrences++;
          if (bug.timestamp < existing.firstSeen) existing.firstSeen = bug.timestamp;
          if (bug.timestamp > existing.lastSeen) existing.lastSeen = bug.timestamp;
        }
      }

      const deduped = Array.from(groups.values()).sort((a, b) => b.occurrences - a.occurrences);

      // Load fix log
      let fixLog = { fixed: {}, dismissed: {} };
      try {
        if (fs.existsSync(fixLogPath)) {
          fixLog = JSON.parse(fs.readFileSync(fixLogPath, 'utf8'));
        }
      } catch { /* ignore */ }

      // Annotate with status
      const annotated = deduped.map(bug => {
        let status = 'open';
        let fixNote = null;
        if (fixLog.fixed[bug.id]) {
          status = 'fixed';
          fixNote = fixLog.fixed[bug.id].note;
        } else if (fixLog.dismissed[bug.id]) {
          status = 'dismissed';
          fixNote = fixLog.dismissed[bug.id].reason;
        }
        return { ...bug, status, fixNote };
      });

      // Summary
      const summary = {
        appId,
        total: appStatements.length,
        unique: deduped.length,
        open: annotated.filter(b => b.status === 'open').length,
        fixed: annotated.filter(b => b.status === 'fixed').length,
        dismissed: annotated.filter(b => b.status === 'dismissed').length,
        bySeverity: {},
        bySource: {}
      };
      for (const bug of annotated.filter(b => b.status === 'open')) {
        summary.bySeverity[bug.severity] = (summary.bySeverity[bug.severity] || 0) + bug.occurrences;
        summary.bySource[bug.source] = (summary.bySource[bug.source] || 0) + bug.occurrences;
      }

      res.json({ configured: true, bugs: annotated, summary, since });
    } catch (err) {
      console.error('[Telemetry] Bug reports fetch failed:', err.message);
      res.status(500).json({ error: 'Failed to fetch bug reports' });
    }
  });

  return router;
}

module.exports = { createBugReportRoutes };
