'use strict';
/**
 * help/routes.js — contextual help endpoints (CONTEXT_HELP.md §11), wired to project invariants:
 *   - persistence: GCS store (cache/help:*.json) with CAS bump  (NOT a filesystem impl)
 *   - LLM: the unified gateway (NOT a provider directly)
 *   - admin analytics: Admin-only (roles)
 * Mounts: GET /config/help-hover · POST /help/ask · GET /admin/help-analytics · POST /tts (optional)
 */
const express = require('express');
const config = require('../config');
const store = require('../store/gcs');
const { callLLM } = require('../llm/gateway');
const loadGroundingDoc = require('./grounding');
const { shortSha1 } = require('../util/hash');
const { requireAdmin } = require('../roles/authz');

const CAPS = { question: 800, snippet: 2000, heading: 200, view: 80, pageTitle: 200,
               locationKey: 120, pathKey: 200, historyTurns: 8, historyTurnChars: 1200 };
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const labelFor = (code) => ({ en: 'English', zh: 'Chinese', es: 'Spanish', fr: 'French',
  de: 'German', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese' }[code] || 'English');

async function bumpHelpStat(cacheKey, { served, update = {} }) {
  return store.mutate(`cache/${cacheKey}.json`, { askCount: 0, hitCount: 0, createdAtMs: Date.now() }, (base) => {
    const now = Date.now();
    const next = { ...base, ...update,
      askCount: (base.askCount || 0) + 1,
      hitCount: (base.hitCount || 0) + (served === 'hit' ? 1 : 0),
      updatedAtMs: now, updatedAt: new Date().toISOString() };
    if (update.analytics) next.analytics = { ...(base.analytics || {}), ...update.analytics };
    return next;
  });
}

function router() {
  const c = config();
  const APP_SLUG = c.appSlug;
  const r = express.Router();
  const langFromReq = (req) =>
    String(req.query.lang || req.get('x-app-lang') || (req.cookies && req.cookies[c.langCookie]) || 'en').toLowerCase();

  r.get('/config/help-hover', (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ dwellMs: c.help.dwellMs, enabled: c.help.dwellMs > 0 });
  });

  r.post('/help/ask', async (req, res) => {
    try {
      const b = req.body || {};
      const question = String(b.question || '').trim();
      if (question.length > CAPS.question) return res.status(400).json({ error: 'question too long' });
      const snippet = String(b.elementSnippet || '').trim().slice(0, CAPS.snippet);
      const nearestHeading = String(b.nearestHeading || '').trim().slice(0, CAPS.heading);
      const viewName = String(b.viewName || '').trim().slice(0, CAPS.view);
      const pageTitle = String(b.pageTitle || '').trim().slice(0, CAPS.pageTitle);
      const locationKey = String(b.locationKey || '').trim().slice(0, CAPS.locationKey);
      const pathKey = (String(b.pathKey || '/').trim().slice(0, CAPS.pathKey)) || '/';
      const locationId = `${APP_SLUG}:${pathKey}:${locationKey || 'loc:unknown'}`;
      const lang = langFromReq(req);
      const langName = labelFor(lang);

      const history = (Array.isArray(b.history) ? b.history : [])
        .filter((t) => t && typeof t.role === 'string' && typeof t.content === 'string')
        .slice(-CAPS.historyTurns)
        .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: t.content.slice(0, CAPS.historyTurnChars) }));

      const { markdown: grounding } = await loadGroundingDoc();
      const system = [
        'You are the contextual help assistant inside this app. Be a concrete tour guide — NOT a coach or evaluator.',
        'Rules:',
        '- 2-5 sentences default. Plain language.',
        '- Light markdown: **bold** key terms, `inline code` for exact UI labels.',
        '- The DOM snippet below is authoritative for what is on screen. Never invent UI not present.',
        '- For purpose/design questions, ground the answer in the document below.',
        // NOTE (team-privacy): if learners may be minors, redact PII from the snippet before this point.
        `- Respond in ${langName}. Do not switch languages mid-answer.`,
        grounding ? '\n=== GROUNDING DOC ===\n' + grounding : '',
      ].join('\n');

      const ctx = [`Page: ${pageTitle || '(unknown)'}${viewName ? `  ·  View: ${viewName}` : ''}`];
      if (nearestHeading) ctx.push(`Nearest heading: ${nearestHeading}`);
      ctx.push('', 'Visible UI under the cursor:', '"""', snippet || '(nothing meaningful)', '"""');
      if (history.length) { ctx.push('', 'Prior turns:'); for (const t of history) ctx.push(`${t.role === 'user' ? 'User' : 'You'}: ${t.content}`); }
      ctx.push('');
      ctx.push(question ? `User's question: ${question}`
        : 'User has not typed a question. Open with one sentence on what this is, then one on the smallest useful next action.');
      const userPrompt = ctx.join('\n');

      const isFirstTurn = history.length === 0;
      const cacheKey = (isFirstTurn && snippet) ? `help:${shortSha1(system + '\u0001' + userPrompt)}` : null;
      const analytics = { locationId, locationKey: locationKey || 'loc:unknown', pathKey, nearestHeading,
        viewName, pageTitle, locationHint: snippet.slice(0, 160), question: question || '(auto-first)', lang };

      if (cacheKey) {
        const cached = await store.get(`cache/${cacheKey}.json`);
        if (cached && cached.answer && Date.now() - (cached.updatedAtMs || 0) < CACHE_TTL_MS) {
          bumpHelpStat(cacheKey, { served: 'hit', update: { analytics } }).catch(() => {});
          callLLM.recordCacheHit({ userId: req.user && req.user.id, feature: 'help', model: c.llm && c.llm.model }).catch(() => {});
          return res.json({ answer: cached.answer, cached: true });
        }
      }
      const answer = (await callLLM({ system, user: userPrompt, maxTokens: 400,
        lang, feature: 'help', userId: req.user && req.user.id }) || '').trim();
      if (cacheKey && answer) await bumpHelpStat(cacheKey, { served: 'miss', update: { answer, lang, analytics } });
      res.json({ answer, cached: false });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/admin/help-analytics', requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(2000, Math.max(50, parseInt(req.query.limit, 10) || 500));
      const entries = await store.listByPrefix('cache/help:', { limit });
      let totalAsks = 0, totalHits = 0;
      for (const { doc } of entries) { totalAsks += +(doc.askCount || 0); totalHits += +(doc.hitCount || 0); }
      const byLoc = new Map();
      for (const { doc } of entries) {
        const a = doc.analytics || {};
        const id = a.locationId || `${APP_SLUG}:(unknown):loc:unknown`;
        let row = byLoc.get(id);
        if (!row) { row = { locationId: id, pathKey: a.pathKey || '', locationKey: a.locationKey || '',
          viewName: a.viewName || '', nearestHeading: a.nearestHeading || '', askCount: 0, hitCount: 0,
          hashCount: 0, langs: {}, _q: new Map(), sampleAnswer: '', _max: 0 }; byLoc.set(id, row); }
        const asks = +(doc.askCount || 0);
        row.askCount += asks; row.hitCount += +(doc.hitCount || 0); row.hashCount += 1;
        const lg = doc.lang || a.lang || 'unknown'; row.langs[lg] = (row.langs[lg] || 0) + asks;
        if (a.question) row._q.set(a.question, (row._q.get(a.question) || 0) + asks);
        if (asks > row._max) { row._max = asks; row.sampleAnswer = String(doc.answer || '').slice(0, 400); }
      }
      const locations = [...byLoc.values()].map((r2) => {
        const topQuestions = [...r2._q.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([q, count]) => ({ q, count }));
        delete r2._q; delete r2._max; return { ...r2, topQuestions };
      }).sort((a, b) => b.askCount - a.askCount);
      res.json({ totalHashes: entries.length, totalAsks, totalHits, locations });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return r;
}
module.exports = router;
