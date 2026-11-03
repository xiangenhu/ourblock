// i18n.js — hash-based UI translation runtime for the SPA (see /team-i18n).
//
// Strings are wrapped at render time with t('English'): we hash the English (SHA-256, first
// 16 hex chars — identical to the server), look the hash up in the current language's
// dictionary, and return the translation (or English if missing). Unknown strings are
// registered with the server (debounced), which translates them via the LLM gateway so the
// next load is complete. The whole API is SYNCHRONOUS after initI18n() preloads the dict,
// so it drops straight into template literals: h(`<h3>${t('Needs Care')}</h3>`).

import { api } from './api.js';

// Supported UI languages with native labels. RTL languages get dir="rtl" at <html>.
export const UI_LANGS_META = [
  { code: 'en', label: 'English' }, { code: 'zh', label: '中文' }, { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' }, { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' }, { code: 'ja', label: '日本語' }, { code: 'ko', label: '한국어' },
  { code: 'th', label: 'ไทย' }, { code: 'vi', label: 'Tiếng Việt (Vietnamese)' }, { code: 'ru', label: 'Русский' },
  { code: 'hi', label: 'हिन्दी' }, { code: 'ar', label: 'العربية' }, { code: 'he', label: 'עברית' },
  { code: 'fa', label: 'فارسی' }, { code: 'ur', label: 'اردو' },
];
const SUPPORTED = new Set(UI_LANGS_META.map((l) => l.code));
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

// ── synchronous SHA-256 (hex) over UTF-8 bytes — matches Node crypto exactly ──────────────
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
function sha256hex(str) {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
    h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bytes = new TextEncoder().encode(str);
  const l = bytes.length;
  const total = (l + 8 + 64) & ~63; // bytes + 0x80 + 8-byte length, padded to a 64-byte multiple
  const m = new Uint8Array(total);
  m.set(bytes);
  m[l] = 0x80;
  const dv = new DataView(m.buffer);
  const bitLen = l * 8;
  dv.setUint32(total - 4, bitLen >>> 0, false);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + hh) >>> 0;
  }
  const hex = (x) => ('00000000' + (x >>> 0).toString(16)).slice(-8);
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

export const hashKey = (en) => sha256hex(String(en).trim()).slice(0, 16);

// ── state ─────────────────────────────────────────────────────────────────────
let _lang = 'en';
let _dict = {};               // hash → translated text (empty for English = identity)
const _seen = new Set();      // hashes already registered this session (dedupe)
let _queue = [];
let _flushTimer = null;

function flush() {
  const items = _queue;
  _queue = [];
  if (items.length) api.post('/api/i18n/register', { items }).catch(() => {});
}
function queueRegister(hash, en) {
  if (_seen.has(hash)) return;
  _seen.add(hash);
  _queue.push({ hash, en });
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flush, 1500);
}

/** Translate an English UI string. Returns the localized text (English when untranslated). */
export function t(en) {
  if (en == null) return '';
  const s = String(en);
  if (!s.trim()) return s;
  const key = hashKey(s);
  queueRegister(key, s.trim());  // discover strings for the registry regardless of language
  if (_lang === 'en') return s;
  return _dict[key] || s;
}

/** Translate a phrase containing {placeholders}, then substitute. Translate WHOLE phrases —
 *  never concatenate translated fragments. e.g. tf('Welcome, {name}', { name }). */
export function tf(en, vars = {}) {
  let out = t(en);
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

export const currentUiLang = () => _lang;
export const isRtl = (lang = _lang) => RTL.has(lang);

function persist(lang) {
  try { localStorage.setItem('preferredLanguage', lang); } catch { /* private mode */ }
  document.cookie = `preferredLanguage=${lang}; max-age=${60 * 60 * 24 * 30}; path=/; samesite=lax`;
}
function applyDir(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
}
const norm = (v) => {
  const c = String(v || '').toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.has(c) ? c : null;
};

/** Detect language: URL param → cookie → localStorage → location hint → navigator → en. */
function detectLang(hint) {
  const q = new URLSearchParams(location.search);
  const url = norm(q.get('lang') || q.get('lng') || q.get('language'));
  const ck = norm((document.cookie.match(/(?:^|;\s*)preferredLanguage=([^;]+)/) || [])[1]);
  let ls = null;
  try { ls = norm(localStorage.getItem('preferredLanguage')); } catch { /* private mode */ }
  const nav = norm(navigator.language || navigator.userLanguage);
  return { lang: url || ck || ls || norm(hint) || nav || 'en', fromUrl: !!url };
}

/** Preload the dictionary for the chosen language. Call once at boot before first render. */
export async function initI18n({ hint } = {}) {
  const { lang, fromUrl } = detectLang(hint);
  _lang = lang;
  applyDir(lang);
  if (fromUrl) persist(lang);
  await loadDict(lang);
  if (window.I18n) window.I18n.lang = _lang;
  return lang;
}

async function loadDict(lang) {
  if (lang === 'en') { _dict = {}; return; }
  try { const { dict } = await api.get(`/api/i18n/dict/${lang}`); _dict = dict || {}; }
  catch { _dict = {}; }
}

/** Switch language (explicit user choice): persist, flip dir, reload dict. Caller re-renders. */
export async function setUiLang(lang) {
  const c = norm(lang);
  if (!c) return _lang;
  _lang = c;
  persist(c);
  applyDir(c);
  await loadDict(c);
  if (window.I18n) window.I18n.lang = c;
  // Notify non-module consumers (contextual-help.js) to re-translate any open UI.
  try { window.dispatchEvent(new Event('i18n:languagechange')); } catch { /* no-op */ }
  return c;
}

/* ── Bridge for classic (non-module) scripts — contextual-help.js expects window.I18n with
 *    { t, lang, applyTo, languages }. applyTo() translates [data-i18n] text nodes and
 *    [data-i18n-attr="a,b"] attributes within a subtree, caching the English source so a
 *    later re-apply (on language change) still works. */
function applyNode(el) {
  if (!el || el.nodeType !== 1) return;
  if (el.hasAttribute('data-i18n')) {
    let src = el.getAttribute('data-i18n');
    if (!src) { src = (el.textContent || '').trim(); if (src) el.setAttribute('data-i18n', src); }
    if (src) el.textContent = t(src);
  }
  const spec = el.getAttribute('data-i18n-attr');
  if (spec) {
    spec.split(',').map((s) => s.trim()).filter(Boolean).forEach((attr) => {
      const key = 'data-i18n-src-' + attr;
      let src = el.getAttribute(key);
      if (src == null) { src = (el.getAttribute(attr) || '').trim(); if (src) el.setAttribute(key, src); }
      if (src) el.setAttribute(attr, t(src));
    });
  }
}
function applyTo(root) {
  if (!root || root.nodeType !== 1) return;
  applyNode(root);
  root.querySelectorAll('[data-i18n],[data-i18n-attr]').forEach(applyNode);
}
if (typeof window !== 'undefined') {
  window.I18n = { t, lang: _lang, applyTo, languages: UI_LANGS_META.map((l) => ({ code: l.code, label: l.label })) };
}
