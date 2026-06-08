'use strict';
/**
 * i18n/hash.js — server-side hash-based i18n (team-i18n).
 * Registry (hash -> { en, zh, ... }) lives in GCS (storage invariant), never the repo.
 * The browser chrome is handled by public/contextual-help.js + your client i18n;
 * this is for server-rendered strings and registering new hashes.
 */
const store = require('../store/gcs');
const { i18nHash } = require('../util/hash');

const REGISTRY_KEY = process.env.I18N_REGISTRY_GCS_PATH || 'i18n/registry.json';
let _cache = null;

async function loadRegistry(force = false) {
  if (_cache && !force) return _cache;
  _cache = (await store.get(REGISTRY_KEY)) || {};
  return _cache;
}

/** Register an English source string if new; returns its hash. */
async function addText(enText) {
  const h = i18nHash(enText);
  await store.mutate(REGISTRY_KEY, {}, (reg) => {
    const r = reg || {};
    if (!r[h]) r[h] = { en: String(enText).trim() };
    return r;
  });
  _cache = null; // invalidate
  return h;
}

/** Translate a source string to lang, falling back to English source. */
async function t(enText, lang = 'en') {
  const reg = await loadRegistry();
  const h = i18nHash(enText);
  const entry = reg[h];
  if (entry && entry[lang]) return entry[lang];
  return String(enText);
}

module.exports = { REGISTRY_KEY, hash: i18nHash, addText, t, loadRegistry };
