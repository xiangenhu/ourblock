'use strict';
// Admin-only LLM cost/usage endpoint (team-cost). Reads the GCS accounting rollups.
//   GET /api/admin/llm-usage?since=7d&group=user|feature|model|total
const express = require('express');
const accounting = require('./accounting');
const { requireAdmin } = require('../roles/authz');

function router() {
  const r = express.Router();
  r.get('/admin/llm-usage', requireAdmin, async (req, res) => {
    try {
      const since = req.query.since || '7d';
      const group = ['user', 'feature', 'model', 'total'].includes(req.query.group) ? req.query.group : 'user';
      res.json(await accounting.summary({ since, groupBy: group }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  return r;
}
module.exports = router;
