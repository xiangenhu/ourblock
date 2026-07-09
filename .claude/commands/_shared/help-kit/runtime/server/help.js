/**
 * routes/help.js — app-wide contextual "?" help assistant (CONTEXT_HELP.md §11),
 * bound to this project's invariants:
 *   - LLM:        the unified llmGateway (never a provider directly)        [llm-gateway]
 *   - Persistence: GCS via helpStore, CAS bump with if-generation-match     [storage-invariants]
 *   - Analytics:  /admin/help-analytics is Admin-only                        [roles]
 *   - Privacy:    learner PII redacted before LLM send AND before caching    [team-privacy]
 *
 * Mounted under /server (see server.js):
 *   GET  /server/config/help-hover    (public)  -> { dwellMs, enabled }
 *   POST /server/help/ask             (public)  -> { answer, cached }
 *   GET  /server/admin/help-analytics (Admin)   -> aggregated by locationId
 *
 * The ask endpoint is public by design: the chip lives on pre-sign-in pages too.
 * It is rate-limited (llmLimiter, in server.js) and input-capped (CAPS below).
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const helpStore = require('../services/helpStore');
const storage = require('../services/storage');
const { llmGateway } = require('../services/llmGateway');
const { optionalAuth, requireAdmin } = require('../middleware/auth');
const { LANGUAGE_NAMES } = require('../utils/language');

const router = express.Router();

const APP_SLUG = process.env.APP_SLUG || 'alwaysai';
const DWELL_MS = parseInt(process.env.HELP_HOVER_DWELL_MS || '3000', 10);
const HELP_MAX_TOKENS = parseInt(process.env.HELP_MAX_TOKENS || '400', 10);
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

const CAPS = {
  question: 800, snippet: 2000, heading: 200, view: 80,
  pageTitle: 200, locationKey: 120, pathKey: 200,
  historyTurns: 8, historyTurnChars: 1200,
};

const shortHash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
const langName = (code) => LANGUAGE_NAMES[code] || LANGUAGE_NAMES.en || 'English';
const langFromReq = (req) =>
  String(req.query.lang || req.get('x-app-lang') ||
    (req.cookies && req.cookies.preferredLanguage) || 'en').toLowerCase();

// ── PII redaction ───────────────────────────────────────────────────────────
// The snippet is live DOM text and may carry a signed-in learner's name/email.
// Redact identifiers before they reach the LLM or the persisted analytics doc.
// (Minors' free-text is never stored tied to identity — the cache doc holds no
// userId/email at all; we additionally scrub identifiers from question/snippet.)
function redactPII(text, extraIdentifiers = []) {
  if (!text) return '';
  let out = String(text);
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]');
  // Phone-like runs: 7+ digits possibly broken by space/dash/paren/plus.
  out = out.replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, (m) =>
    (m.replace(/\D/g, '').length >= 7 ? '[phone]' : m));
  for (const id of extraIdentifiers) {
    if (!id || String(id).length < 3) continue;
    const safe = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(safe, 'gi'), '[redacted]');
  }
  return out;
}

// ── Grounding doc (cached) ───────────────────────────────────────────────────
// Purpose ("why is this here?") answers ground in a product/design brief. By
// default it lives in GCS at GROUNDING_DOC_PATH; override with HELP_GROUNDING_DOC.
// Falls back to the bundled copy (server/data/help-grounding.md) when GCS is
// unconfigured or the object is missing — mirrors the /server/assets pattern.
const GROUNDING_DOC_PATH = process.env.HELP_GROUNDING_DOC || 'shared/help/grounding.md';
const GROUNDING_LOCAL_FALLBACK = path.join(__dirname, '../data/help-grounding.md');
let _grounding = null;
async function loadGroundingDoc() {
  if (_grounding !== null) return _grounding;
  // Try GCS first (source of truth).
  if (storage.isConfigured()) {
    try {
      const buf = await storage.downloadFile(GROUNDING_DOC_PATH);
      if (buf && buf.length) return (_grounding = buf.toString('utf8').slice(0, 12000));
    } catch (_) { /* fall through to local */ }
  }
  // Local bundled fallback.
  try {
    _grounding = fs.readFileSync(GROUNDING_LOCAL_FALLBACK, 'utf8').slice(0, 12000);
  } catch (_) {
    _grounding = '';
  }
  return _grounding;
}

// ── frequency analytics bump (CAS) ───────────────────────────────────────────
async function bumpHelpStat(cacheKey, { served, update = {} }) {
  return helpStore.mutate(
    `cache/${cacheKey}.json`,
    { askCount: 0, hitCount: 0, createdAtMs: Date.now() },
    (base) => {
      const now = Date.now();
      const next = {
        ...base, ...update,
        askCount: (base.askCount || 0) + 1,
        hitCount: (base.hitCount || 0) + (served === 'hit' ? 1 : 0),
        updatedAtMs: now,
        updatedAt: new Date().toISOString(),
      };
      if (update.analytics) next.analytics = { ...(base.analytics || {}), ...update.analytics };
      return next;
    }
  );
}

// ── GET /config/help-hover (public) ──────────────────────────────────────────
router.get('/config/help-hover', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ dwellMs: DWELL_MS, enabled: DWELL_MS > 0 });
});

// ── POST /help/ask (public) ──────────────────────────────────────────────────
router.post('/help/ask', optionalAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const rawQuestion = String(b.question || '').trim();
    if (rawQuestion.length > CAPS.question) {
      return res.status(400).json({ error: 'question too long' });
    }

    // Identifiers to scrub if they happen to appear in the captured DOM text.
    const idHints = [req.user && req.user.email, req.user && req.user.name].filter(Boolean);

    const question = redactPII(rawQuestion, idHints);
    const snippet = redactPII(String(b.elementSnippet || '').trim().slice(0, CAPS.snippet), idHints);
    const nearestHeading = redactPII(String(b.nearestHeading || '').trim().slice(0, CAPS.heading), idHints);
    const viewName = String(b.viewName || '').trim().slice(0, CAPS.view);
    const pageTitle = String(b.pageTitle || '').trim().slice(0, CAPS.pageTitle);
    const locationKey = String(b.locationKey || '').trim().slice(0, CAPS.locationKey);
    const pathKey = (String(b.pathKey || '/').trim().slice(0, CAPS.pathKey)) || '/';
    const locationId = `${APP_SLUG}:${pathKey}:${locationKey || 'loc:unknown'}`;

    const lang = langFromReq(req);
    const name = langName(lang);

    const history = (Array.isArray(b.history) ? b.history : [])
      .filter((t) => t && typeof t.role === 'string' && typeof t.content === 'string')
      .slice(-CAPS.historyTurns)
      .map((t) => ({
        role: t.role === 'assistant' ? 'assistant' : 'user',
        content: redactPII(t.content.slice(0, CAPS.historyTurnChars), idHints),
      }));

    const grounding = await loadGroundingDoc();

    // System prompt: a tour guide, NOT a coach/evaluator (team-ai-safety). Building
    // `name` into the system string is what puts language into the cache key by
    // construction — a zh reader can never be served an en cached answer.
    const system = [
      'You are the contextual help assistant inside this app. Be a friendly, concrete tour guide — NOT a coach, reviewer, or evaluator. Never do the user\'s work for them.',
      'Rules:',
      '- 2-5 sentences default. Plain language.',
      '- Light markdown: **bold** for key terms, `inline code` for exact UI labels; short bullet lists only when you genuinely need 2-4 options.',
      '- The DOM snippet below is authoritative for what is actually on screen. Describe buttons, fields, and sections using the words that appear there. Never invent UI that is not present.',
      '- If the snippet is a form input, say what to type and why it matters. If it is a button, say what happens when clicked. If a tile, say what the task is and the smallest useful next step.',
      '- For purpose/design ("why is this here?") questions, ground the answer in the document below.',
      '- If the snippet is too ambiguous, say so and suggest hovering on a more specific area.',
      `- Respond in ${name}. Do not switch languages mid-answer.`,
      grounding ? '\n=== GROUNDING DOC (authoritative for purpose questions) ===\n' + grounding : '',
    ].join('\n');

    const ctx = [`Page: ${pageTitle || '(unknown)'}${viewName ? `  ·  View: ${viewName}` : ''}`];
    if (nearestHeading) ctx.push(`Nearest heading: ${nearestHeading}`);
    ctx.push('', 'Visible UI under the cursor (text content, trimmed):', '"""',
      snippet || '(the cursor was not over any meaningful element)', '"""');
    if (history.length) {
      ctx.push('', 'Prior turns in this help thread:');
      for (const t of history) ctx.push(`${t.role === 'user' ? 'User' : 'You'}: ${t.content}`);
    }
    ctx.push('');
    ctx.push(question
      ? `User's question: ${question}`
      : 'User has not typed a question yet — they paused on this part of the UI. Open with one sentence telling them what this is, then one sentence with the smallest useful next action.');
    ctx.push('', `Respond directly in ${name}. Do not repeat the question.`);
    const userPrompt = ctx.join('\n');

    // First-turn-only cache; follow-ups depend on conversation state.
    const isFirstTurn = history.length === 0;
    const cacheKey = (isFirstTurn && snippet) ? `help:${shortHash(system + '' + userPrompt)}` : null;

    // Analytics doc carries NO user identity by design (aggregated, identity-free).
    const analytics = {
      locationId, locationKey: locationKey || 'loc:unknown', pathKey,
      nearestHeading, viewName, pageTitle,
      locationHint: snippet.slice(0, 160),
      question: question || '(auto-first)',
      lang,
    };

    if (cacheKey) {
      const cached = await helpStore.get(`cache/${cacheKey}.json`);
      if (cached && cached.answer && Date.now() - (cached.updatedAtMs || 0) < CACHE_TTL_MS) {
        // Cache hit short-circuits the LLM entirely (cost lever).
        bumpHelpStat(cacheKey, { served: 'hit', update: { analytics } }).catch(() => {});
        return res.json({ answer: cached.answer, cached: true });
      }
    }

    const messages = [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: userPrompt },
    ];
    const result = await llmGateway.chat(messages, {
      maxTokens: HELP_MAX_TOKENS,
      ...(process.env.HELP_LLM_PROVIDER ? { provider: process.env.HELP_LLM_PROVIDER } : {}),
      ...(process.env.HELP_LLM_MODEL ? { model: process.env.HELP_LLM_MODEL } : {}),
      analyticsContext: {
        activityType: 'help',
        userId: req.user && (req.user.userId || req.user.id),
        userEmail: req.user && req.user.email,
        language: lang,
      },
    });
    const answer = String(typeof result === 'string' ? result : (result && result.content) || '').trim();

    if (cacheKey && answer) {
      await bumpHelpStat(cacheKey, { served: 'miss', update: { answer, lang, analytics } });
    }
    res.json({ answer, cached: false });
  } catch (e) {
    console.error('[help/ask]', e.message);
    res.status(500).json({ error: 'Help unavailable' });
  }
});

// ── GET /admin/help-analytics (Admin-only) ───────────────────────────────────
router.get('/admin/help-analytics', ...requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(2000, Math.max(50, parseInt(req.query.limit, 10) || 500));
    const group = req.query.group === 'none' ? 'none' : 'location';
    const entries = await helpStore.listByPrefix('cache/help:', { limit });

    let totalAsks = 0, totalHits = 0;
    for (const { doc } of entries) {
      totalAsks += Number(doc.askCount || 0);
      totalHits += Number(doc.hitCount || 0);
    }

    if (group === 'none') {
      const rows = entries.map(({ key, doc }) => ({
        cacheKey: key,
        locationId: (doc.analytics && doc.analytics.locationId) || null,
        askCount: Number(doc.askCount || 0),
        hitCount: Number(doc.hitCount || 0),
        lang: doc.lang || (doc.analytics && doc.analytics.lang) || null,
        viewName: (doc.analytics && doc.analytics.viewName) || '',
        nearestHeading: (doc.analytics && doc.analytics.nearestHeading) || '',
        question: (doc.analytics && doc.analytics.question) || '',
        locationHint: (doc.analytics && doc.analytics.locationHint) || '',
        firstAskedAt: doc.createdAtMs || null,
        lastAskedAt: doc.updatedAtMs || null,
      })).sort((a, b) => b.askCount - a.askCount);
      return res.json({ totalHashes: entries.length, totalAsks, totalHits, entries: rows });
    }

    const byLoc = new Map();
    for (const { key, doc } of entries) {
      const a = doc.analytics || {};
      const id = a.locationId || `${APP_SLUG}:(unknown):loc:unknown`;
      let row = byLoc.get(id);
      if (!row) {
        row = {
          locationId: id, pathKey: a.pathKey || '', locationKey: a.locationKey || '',
          viewName: a.viewName || '', nearestHeading: a.nearestHeading || '',
          askCount: 0, hitCount: 0, hashCount: 0, langs: {},
          _q: new Map(), sampleAnswer: '', sampleCacheKey: '',
          firstAskedAt: null, lastAskedAt: null, _max: 0,
        };
        byLoc.set(id, row);
      }
      const asks = Number(doc.askCount || 0);
      row.askCount += asks; row.hitCount += Number(doc.hitCount || 0); row.hashCount += 1;
      const lg = doc.lang || a.lang || 'unknown';
      row.langs[lg] = (row.langs[lg] || 0) + asks;
      if (a.question) row._q.set(a.question, (row._q.get(a.question) || 0) + asks);
      if (asks > row._max) {
        row._max = asks;
        row.viewName = a.viewName || row.viewName;
        row.nearestHeading = a.nearestHeading || row.nearestHeading;
        row.sampleAnswer = String(doc.answer || '').slice(0, 400);
        row.sampleCacheKey = key;
      }
      const f = Number(doc.createdAtMs || 0), l = Number(doc.updatedAtMs || 0);
      if (f && (!row.firstAskedAt || f < row.firstAskedAt)) row.firstAskedAt = f;
      if (l && (!row.lastAskedAt || l > row.lastAskedAt)) row.lastAskedAt = l;
    }

    const locations = [...byLoc.values()].map((r) => {
      const topQuestions = [...r._q.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([q, count]) => ({ q, count }));
      delete r._q; delete r._max;
      return { ...r, topQuestions };
    }).sort((a, b) => b.askCount - a.askCount);

    res.json({ totalHashes: entries.length, totalAsks, totalHits, locations });
  } catch (e) {
    console.error('[help/analytics]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
