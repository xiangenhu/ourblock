'use strict';
/**
 * llm/cache.js — variant-pool cache for LLM responses (the "CACHE_MAX copies" design).
 *
 * Per unique request hash we keep up to CACHE_MAX response *variants*. Serving policy
 * (see plan()):
 *   - 0 cached      -> caller must generate synchronously and store variant #1
 *   - 0 < n < MAX   -> serve a random cached variant NOW (no wait); background-generate one more
 *   - n >= MAX      -> serve a random cached variant; do not generate
 * This bounds cost to at most CACHE_MAX generations per unique request, then ~0, while giving
 * response variety (useful for educational phrasing) and removing latency on warm requests.
 *
 * Backends (LLM_CACHE_BACKEND):
 *   'gcs' (recommended, default) — variants under cache/llm/{hash}/{id}.json (storage invariant).
 *   'lrs'                        — variants as xAPI statements (verb 'generated',
 *                                  object.id = {APP_URL}/llm-cache/{hash}) in a DEDICATED cache LRS.
 *   'off'                        — disabled.
 *
 * IMPORTANT: only pooled-cache requests that are context-complete and PII-free. The hash must
 * include everything that should differentiate a correct answer (the gateway hashes the final
 * system+user, so the injected language directive is already in the key). Never pool personalized,
 * stateful (multi-turn), tool-using, or learner-PII requests (team-privacy).
 */
const crypto = require('crypto');
const config = require('../config');

/** Pure serving plan — unit-testable, no I/O. */
function plan(count, max) {
  if (count <= 0) return { serveFromCache: false, generateSync: true, backgroundFill: false };
  if (count < max) return { serveFromCache: true, generateSync: false, backgroundFill: true };
  return { serveFromCache: true, generateSync: false, backgroundFill: false };
}
function pick(variants) { return variants[Math.floor(Math.random() * variants.length)]; }

// ── GCS backend ────────────────────────────────────────────────────────────
const gcsBackend = {
  async list(hash, ttlMs) {
    const store = require('../store/gcs');
    const now = Date.now();
    const rows = await store.listByPrefix(`cache/llm/${hash}/`, { limit: 64 });
    return rows.map(({ doc }) => doc).filter((d) => d && d.answer && (now - (d.createdAtMs || 0) < ttlMs));
  },
  async add(hash, { answer, model }) {
    const store = require('../store/gcs');
    const id = crypto.randomUUID();
    await store.set(`cache/llm/${hash}/${id}.json`, { answer, model, createdAtMs: Date.now() });
  },
};

// ── LRS backend (dedicated cache LRS; never the learning LRS) ────────────────
function cacheLrs() {
  const c = config().llm.cache.lrs;
  if (!c.endpoint || !c.username || !c.password) {
    throw new Error('[llm-cache] LLM_CACHE_LRS_* not configured (backend=lrs). Use a DEDICATED cache LRS, not the learning LRS.');
  }
  return { ...c, auth: Buffer.from(`${c.username}:${c.password}`).toString('base64') };
}
const lrsBackend = {
  activityId(hash) { return `${config().appUrl}/llm-cache/${hash}`; },
  async list(hash, ttlMs) {
    const l = cacheLrs(); const now = Date.now();
    const url = `${l.endpoint}/statements?activity=${encodeURIComponent(this.activityId(hash))}&limit=64`;
    const r = await fetch(url, { headers: { Authorization: `Basic ${l.auth}`, 'X-Experience-API-Version': '1.0.3' } });
    if (!r.ok) return [];
    const data = await r.json().catch(() => ({ statements: [] }));
    const APP = config().appUrl;
    return (data.statements || [])
      .map((s) => ({ answer: s.context && s.context.extensions && s.context.extensions[`${APP}/answer`],
                     model: s.context && s.context.extensions && s.context.extensions[`${APP}/model`],
                     createdAtMs: Date.parse(s.timestamp) || 0 }))
      .filter((d) => d.answer && (now - d.createdAtMs < ttlMs));
  },
  async add(hash, { answer, model }) {
    const l = cacheLrs(); const APP = config().appUrl;
    const stmt = {
      id: crypto.randomUUID(), timestamp: new Date().toISOString(),
      actor: { objectType: 'Agent', name: 'LLM Cache', mbox: `mailto:llm-cache@${APP.replace(/^https?:\/\//, '')}` },
      verb: { id: 'http://activitystrea.ms/schema/1.0/generate', display: { 'en-US': 'generated' } },
      object: { objectType: 'Activity', id: this.activityId(hash),
        definition: { type: 'http://adlnet.gov/expapi/activities/interaction', name: { 'en-US': `llm-cache ${hash}` } } },
      // long text in extensions, never result.response (project xAPI rule)
      context: { extensions: { [`${APP}/answer`]: String(answer).slice(0, 16000), [`${APP}/model`]: model || '' } },
    };
    await fetch(`${l.endpoint}/statements`, { method: 'POST',
      headers: { Authorization: `Basic ${l.auth}`, 'X-Experience-API-Version': '1.0.3', 'Content-Type': 'application/json' },
      body: JSON.stringify(stmt) });
  },
};

function backend() {
  const b = config().llm.cache.backend;
  if (b === 'lrs') return lrsBackend;
  if (b === 'off') return null;
  return gcsBackend;
}

const hashRequest = (model, system, user) =>
  crypto.createHash('sha256').update(`${model}\u0001${system || ''}\u0001${user || ''}`).digest('hex').slice(0, 24);

async function list(hash, ttlMs = config().llm.cache.ttlMs) {
  const b = backend(); if (!b) return [];
  try { return await b.list(hash, ttlMs); } catch (_) { return []; }
}
async function add(hash, variant, max = config().llm.cache.max) {
  const b = backend(); if (!b) return;
  try {
    const cur = await b.list(hash, config().llm.cache.ttlMs);
    if (cur.length >= max) return; // cap reached (best-effort; CAS not strictly needed for a pool)
    await b.add(hash, variant);
  } catch (_) { /* cache failures must not break the call */ }
}

module.exports = { plan, pick, hashRequest, list, add, enabled: () => config().llm.cache.backend !== 'off' };
