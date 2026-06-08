'use strict';
/**
 * llm/gateway.js — the ONE chokepoint for every LLM call (see _shared/llm-gateway.md).
 * Centralizes: (1) LANGUAGE consistency, (2) TOKEN ACCOUNTING, (3) variant-pool CACHE,
 * (4) PROVIDER choice. No feature code may call a provider directly.
 *
 * callLLM({ system, user, lang, userId, feature, maxTokens, model, cache }) -> string
 *   cache: true | false | { max }   (defaults to config LLM_CACHE_DEFAULT)
 * Back-compatible: callers passing only {system,user} still work.
 */
const config = require('../config');
const accounting = require('./accounting');
const llmCache = require('./cache');

const LANG_NAME = { en: 'English', zh: 'Chinese', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', th: 'Thai', vi: 'Vietnamese',
  ru: 'Russian', hi: 'Hindi', ar: 'Arabic', he: 'Hebrew', fa: 'Persian', ur: 'Urdu' };
function langDirective(lang) {
  if (!lang) return '';
  const name = LANG_NAME[String(lang).toLowerCase()] || 'English';
  return `Respond in ${name}. Do not switch languages mid-answer.`;
}

// Raw provider call (the only place that touches the provider). Returns { answer, usage }.
async function callProvider({ sys, user, model, maxTokens }) {
  const c = config.requireLlm();
  const r = await fetch(c.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
    body: JSON.stringify({ model, max_tokens: maxTokens || c.maxTokens,
      messages: [...(sys ? [{ role: 'system', content: sys }] : []), { role: 'user', content: String(user || '') }] }),
  });
  if (!r.ok) { const d = await r.text().catch(() => ''); throw new Error(`[llm] gateway ${r.status}: ${d.slice(0, 300)}`); }
  const data = await r.json();
  const answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  return { answer, usage: data.usage || {} };
}

async function generateAndStore({ sys, user, model, maxTokens, userId, feature, hash, cacheOn, max }) {
  const { answer, usage } = await callProvider({ sys, user, model, maxTokens });
  await accounting.record({ userId, feature, model, usage, cached: false });
  if (cacheOn && answer) await llmCache.add(hash, { answer, model }, max);
  return answer;
}

async function callLLM({ system, user, lang, userId, feature = 'general', maxTokens, model, cache } = {}) {
  const c = config.requireLlm();
  const chosenModel = model || c.model;
  const sys = [system, langDirective(lang)].filter(Boolean).join('\n'); // language enforced centrally

  const cfg = config().llm.cache;
  const cacheOn = llmCache.enabled() && (cache === undefined ? cfg.defaultOn : !!cache);
  const max = (cache && typeof cache === 'object' && cache.max) || cfg.max;

  if (!cacheOn) {
    return generateAndStore({ sys, user, model: chosenModel, maxTokens, userId, feature, hash: null, cacheOn: false, max });
  }

  const hash = llmCache.hashRequest(chosenModel, sys, user); // language already in sys -> in key
  const pool = await llmCache.list(hash);
  const p = llmCache.plan(pool.length, max);

  if (p.generateSync) {
    // cold: nothing to serve — must generate and store variant #1
    return generateAndStore({ sys, user, model: chosenModel, maxTokens, userId, feature, hash, cacheOn: true, max });
  }

  // warm: serve a cached variant immediately (no wait)
  const chosen = llmCache.pick(pool);
  accounting.record({ userId, feature, model: chosen.model || chosenModel, usage: {}, cached: true }).catch(() => {});
  if (p.backgroundFill) {
    // fire-and-forget: top up the pool toward CACHE_MAX without blocking this response
    generateAndStore({ sys, user, model: chosenModel, maxTokens, userId, feature, hash, cacheOn: true, max })
      .catch(() => {});
  }
  return chosen.answer;
}

// Explicit cache-hit accounting hook (used by features with their own bespoke cache, e.g. help).
callLLM.recordCacheHit = function ({ userId, feature = 'general', model } = {}) {
  return accounting.record({ userId, feature, model: model || config().llm.model, usage: {}, cached: true });
};

module.exports = { callLLM, langDirective };
