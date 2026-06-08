'use strict';
/**
 * llm/accounting.js — per-user token accounting for cost (team-cost).
 * Records every real LLM call (cache hits recorded as cached, ~0 cost) to GCS, keyed per day+user:
 *   usage/{YYYY-MM-DD}/{userId}.json
 * Stores token COUNTS only (no prompt content). Use an OPAQUE userId, never an email
 * (team-privacy: pseudonymize for analytics; counts aren't PII but the identity link is).
 *
 * Pure helpers (estimateCostUsd, mergeEntry) are exported for unit testing without GCS.
 */
const store = require('../store/gcs');
const config = require('../config');

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const keyFor = (date, userId) => `usage/${date}/${String(userId || 'anonymous')}.json`;

/** prices: { model: { in: $per1M_prompt, out: $per1M_completion } }. Override via env LLM_PRICES (JSON). */
function prices() {
  const c = config();
  return c.llm.prices || {};
}
function estimateCostUsd(model, usage, priceMap = prices()) {
  const p = priceMap[model] || priceMap['*'] || null;
  if (!p) return 0;
  const inT = (usage && usage.prompt_tokens) || 0;
  const outT = (usage && usage.completion_tokens) || 0;
  return (inT / 1e6) * (p.in || 0) + (outT / 1e6) * (p.out || 0);
}

/** Merge one call into a per-(day,user) rollup doc. Pure — unit-testable. */
function mergeEntry(doc, { feature = 'general', model = 'unknown', usage = {}, cached = false }, priceMap = prices()) {
  const base = doc || { userId: null, date: null, features: {}, calls: 0, cachedCalls: 0,
                        promptTokens: 0, completionTokens: 0, totalTokens: 0, estCostUsd: 0 };
  const inT = usage.prompt_tokens || 0, outT = usage.completion_tokens || 0;
  const tot = usage.total_tokens || (inT + outT);
  const cost = cached ? 0 : estimateCostUsd(model, usage, priceMap);
  base.calls += 1;
  if (cached) base.cachedCalls += 1;
  base.promptTokens += inT; base.completionTokens += outT; base.totalTokens += tot;
  base.estCostUsd = +(base.estCostUsd + cost).toFixed(6);
  const f = (base.features[feature] = base.features[feature] || { byModel: {} });
  const m = (f.byModel[model] = f.byModel[model] || { calls: 0, cachedCalls: 0, promptTokens: 0, completionTokens: 0, estCostUsd: 0 });
  m.calls += 1; if (cached) m.cachedCalls += 1;
  m.promptTokens += inT; m.completionTokens += outT; m.estCostUsd = +(m.estCostUsd + cost).toFixed(6);
  return base;
}

/** Record a call. Never throws (accounting must not break a request). */
async function record({ userId, feature, model, usage, cached = false } = {}) {
  try {
    const date = day();
    await store.mutate(keyFor(date, userId), { userId, date, features: {}, calls: 0, cachedCalls: 0,
      promptTokens: 0, completionTokens: 0, totalTokens: 0, estCostUsd: 0 },
      (doc) => { const d = mergeEntry(doc, { feature, model, usage, cached }); d.userId = userId || 'anonymous'; d.date = date; return d; });
  } catch (e) { /* swallow — see [BugReporter] note; do not let accounting break the call */ }
}

/** Aggregate usage since a date window. groupBy: 'user' | 'feature' | 'model' | 'total'. */
async function summary({ since = '7d', groupBy = 'user', limit = 5000 } = {}) {
  const m = String(since).match(/^(\d+)(d|w)$/);
  const days = m ? (m[2] === 'w' ? +m[1] * 7 : +m[1]) : 7;
  const cutoff = day(new Date(Date.now() - days * 864e5));
  const entries = await store.listByPrefix('usage/', { limit });
  const rows = entries
    .filter(({ key }) => { const dm = key.match(/usage\/(\d{4}-\d{2}-\d{2})\//); return dm && dm[1] >= cutoff; })
    .map(({ doc }) => doc);
  const totals = { calls: 0, cachedCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estCostUsd: 0 };
  const groups = new Map();
  for (const d of rows) {
    totals.calls += d.calls || 0; totals.cachedCalls += d.cachedCalls || 0;
    totals.promptTokens += d.promptTokens || 0; totals.completionTokens += d.completionTokens || 0;
    totals.totalTokens += d.totalTokens || 0; totals.estCostUsd += d.estCostUsd || 0;
    let bucketKeys = [];
    if (groupBy === 'user') bucketKeys = [d.userId || 'anonymous'];
    else if (groupBy === 'feature') bucketKeys = Object.keys(d.features || {});
    else if (groupBy === 'model') bucketKeys = [...new Set(Object.values(d.features || {}).flatMap((f) => Object.keys(f.byModel || {})))];
    else bucketKeys = ['all'];
    for (const k of bucketKeys) {
      const g = groups.get(k) || { key: k, calls: 0, cachedCalls: 0, promptTokens: 0, completionTokens: 0, estCostUsd: 0 };
      g.calls += d.calls || 0; g.cachedCalls += d.cachedCalls || 0;
      g.promptTokens += d.promptTokens || 0; g.completionTokens += d.completionTokens || 0; g.estCostUsd += d.estCostUsd || 0;
      groups.set(k, g);
    }
  }
  totals.estCostUsd = +totals.estCostUsd.toFixed(4);
  return { since: cutoff, groupBy, totals, groups: [...groups.values()].sort((a, b) => b.estCostUsd - a.estCostUsd) };
}

module.exports = { record, summary, estimateCostUsd, mergeEntry, keyFor };
