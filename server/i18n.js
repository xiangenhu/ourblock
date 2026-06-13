/**
 * i18n.js — hash-based UI translation registry (see /team-i18n).
 *
 * The registry is a SINGLE GCS object — `i18n/registry.json` (storage-invariant: no repo
 * files, no localStorage). Shape:
 *   { "<hash>": { en: "Continue", zh: "继续", es: "Continuar", … }, … }
 * where <hash> = first 16 hex chars of SHA-256(trimmed English) — the same convention the
 * client computes, so a string hashes identically on both sides.
 *
 *   getDict(lang)            -> { hash: text }   (text falls back to English)
 *   registerHashes(items)    -> [{hash,en}] of the NEWLY-seen strings
 *   translateAndStore(items) -> fills every target language via the single LLM gateway
 *
 * Flow: the client registers English strings it renders; we store English immediately and
 * translate in the background, so the next dictionary fetch for a language is complete.
 */
import crypto from 'crypto';
import store from './store/gcs.js';
import config from './config.js';
import { callLLM } from './llm/gateway.js';

const REGISTRY_KEY = 'i18n/registry.json';

// Supported UI languages (en is the source of truth). RTL set applied as dir="rtl" client-side.
export const UI_LANGS = ['en', 'zh', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'th', 'vi', 'ru', 'hi', 'ar', 'he', 'fa', 'ur'];
export const RTL_LANGS = ['ar', 'he', 'fa', 'ur'];
const TARGETS = UI_LANGS.filter((l) => l !== 'en');

/** Same hash the client uses: SHA-256(trimmed) → first 16 hex chars. */
export function hashKey(en) {
  return crypto.createHash('sha256').update(String(en).trim()).digest('hex').slice(0, 16);
}

export async function getRegistry() {
  return (await store.get(REGISTRY_KEY)) || {};
}

/** { hash: text-for-lang } with English fallback — what the client loads per language. */
export async function getDict(lang) {
  const reg = await getRegistry();
  const dict = {};
  for (const [hash, entry] of Object.entries(reg)) {
    dict[hash] = entry[lang] || entry.en || '';
  }
  return dict;
}

/** Store English for any unseen hashes; return only the freshly-added ones. */
export async function registerHashes(items) {
  const fresh = [];
  await store.mutate(REGISTRY_KEY, {}, (reg) => {
    for (const it of items) {
      const en = (it?.en || '').trim();
      const hash = (it?.hash || (en && hashKey(en)) || '').trim();
      if (!hash || !en) continue;
      if (!reg[hash]) { reg[hash] = { en }; fresh.push({ hash, en }); }
      else if (!reg[hash].en) reg[hash].en = en;
    }
    return reg;
  });
  return fresh;
}

const TR_SYSTEM =
  'You are a professional UI localizer for "Our Block", a warm neighbourhood civic-wellbeing app. ' +
  'Translate each English UI string into {LANG}. Keep it concise and natural for a mobile app UI. ' +
  'Preserve placeholders like {name}, %s, and emoji EXACTLY. Do not translate the brand name "Our Block". ' +
  'Return ONLY a JSON object mapping each given id to its translation, e.g. {"id1":"…","id2":"…"}.';

/** Translate one batch into one language. Returns { hash: translation }. */
async function translateInto(lang, items, userId) {
  const payload = items.map((it, i) => ({ id: String(i), text: it.en }));
  const txt = await callLLM({
    feature: 'i18n',
    userId,
    maxTokens: Math.min(4000, 200 + items.length * 40),
    json: true,
    system: TR_SYSTEM.replace('{LANG}', lang),
    user: JSON.stringify({ strings: payload }),
  });
  if (!txt) return {};
  const obj = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  const out = {};
  items.forEach((it, i) => {
    const v = obj[String(i)];
    if (typeof v === 'string' && v.trim()) out[it.hash] = v.trim();
  });
  return out;
}

/**
 * Translate `items` ([{hash,en}]) into every target language and merge into the registry.
 * Best-effort: a failing language is skipped, never throws to the caller (fire-and-forget).
 */
export async function translateAndStore(items, { userId } = {}) {
  if (!config.has.llm() || !items?.length) return;
  const BATCH = 40;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const perLang = await Promise.all(
      TARGETS.map((lang) => translateInto(lang, batch, userId).then((d) => [lang, d]).catch(() => [lang, {}]))
    );
    await store.mutate(REGISTRY_KEY, {}, (reg) => {
      for (const [lang, dict] of perLang) {
        for (const [hash, text] of Object.entries(dict)) {
          if (reg[hash]) reg[hash][lang] = text;
        }
      }
      return reg;
    });
  }
}
