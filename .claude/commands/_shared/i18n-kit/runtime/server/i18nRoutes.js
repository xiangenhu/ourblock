/**
 * Hash-based i18n — Express router (Node.js + GCS)
 * ===========================================================================
 * Serves per-language translation files from Google Cloud Storage (with a local
 * filesystem fallback + English-template auto-create), performs on-demand LLM
 * translation, and runs the Translation Suggestion Mode review loop.
 *
 * This is a FACTORY so it drops into any of our apps regardless of where that
 * app keeps its storage service / auth middleware / LLM gateway. Mount it once:
 *
 *   const { createI18nRouter } = require('./i18n/i18nRoutes');
 *   const storage = require('../services/storage');          // your GCS service
 *   const { requireTeacher, requireAdmin } = require('../middleware/auth');
 *   const { llmGateway } = require('../services/llmGateway');
 *
 *   app.use('/server/i18n', createI18nRouter({
 *     storage,
 *     requireTeacher,
 *     requireAdmin,
 *     // optional: enables POST /translate (on-demand LLM translation)
 *     llmTranslate: async ({ text, targetLang, languageName }) => {
 *       const r = await llmGateway.chat(
 *         [{ role: 'user', content: `Translate to ${languageName}. Return ONLY the translation: "${text}"` }],
 *         { temperature: 0.1, maxTokens: 200 }
 *       );
 *       const out = typeof r === 'string' ? r : (r?.content || '');
 *       return out.trim().replace(/^["']|["']$/g, '');
 *     },
 *     // optional: local dir(s) to fall back to when GCS lacks a locale
 *     localesFsPath: path.join(__dirname, '../../client/public/locales')
 *   }));
 *
 * INTEGRATION CONTRACT — `storage` must expose (our standard GCS service shape):
 *   isConfigured(): boolean
 *   uploadFile(buffer, fileName, { folder, contentType, cacheControl }): Promise
 *   downloadFile(path): Promise<Buffer>          // rejects if missing
 *   listFiles(prefix): Promise<Array<{ name }>>
 * `requireTeacher` / `requireAdmin` are Express middleware arrays (e.g.
 *   [requireAuth, requireRole('instructor','admin', …)]) — see the kit README.
 */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

const DEFAULT_SUPPORTED_LANGUAGES = {
  en: { name: 'English', dir: 'ltr' },
  zh: { name: '中文', dir: 'ltr' },
  es: { name: 'Español', dir: 'ltr' },
  fr: { name: 'Français', dir: 'ltr' },
  de: { name: 'Deutsch', dir: 'ltr' },
  ja: { name: '日本語', dir: 'ltr' },
  ko: { name: '한국어', dir: 'ltr' },
  ar: { name: 'العربية', dir: 'rtl' },
  he: { name: 'עברית', dir: 'rtl' },
  pt: { name: 'Português', dir: 'ltr' },
  ru: { name: 'Русский', dir: 'ltr' },
  it: { name: 'Italiano', dir: 'ltr' },
  nl: { name: 'Nederlands', dir: 'ltr' },
  vi: { name: 'Tiếng Việt', dir: 'ltr' },
  th: { name: 'ไทย', dir: 'ltr' },
  hi: { name: 'हिन्दी', dir: 'ltr' },
  tr: { name: 'Türkçe', dir: 'ltr' },
  pl: { name: 'Polski', dir: 'ltr' },
  uk: { name: 'Українська', dir: 'ltr' },
  id: { name: 'Bahasa Indonesia', dir: 'ltr' }
};

// Skip LLM translation when the text is already in the target script.
const LANG_SCRIPT_PATTERNS = {
  zh: /[一-鿿㐀-䶿]/, ja: /[぀-ヿ一-鿿]/,
  ko: /[가-힯]/, ar: /[؀-ۿ]/, he: /[֐-׿]/,
  hi: /[ऀ-ॿ]/, th: /[฀-๿]/, ru: /[Ѐ-ӿ]/, uk: /[Ѐ-ӿ]/
};

const SUGGESTIONS_FOLDER = 'locales/suggestions';
const SUGGESTION_STATUSES = ['pending', 'approved', 'rejected'];
const noop = (req, res, next) => next();

function createI18nRouter(deps = {}) {
  const {
    storage,
    requireTeacher = [noop],
    requireAdmin = [noop],
    llmTranslate = null,
    // optional: ({ english, current, lang, languageName, req }) => Promise<string[]>
    // enables POST /suggest-alternatives (AI options in the Language Suggestion modal)
    llmSuggestAlternatives = null,
    localesFsPath = null,
    supportedLanguages = DEFAULT_SUPPORTED_LANGUAGES,
    // Debugging mode: open *suggesting* to any user (incl. guests) instead of
    // teacher/admin. Approve/reject stays admin-only. Defaults from env.
    suggestOpen = /^debug/i.test(process.env.I18N_SUGGEST_MODE || ''),
    // Middleware used for the open gate (host passes its optionalAuth/guest-aware auth).
    optionalAuth = [noop]
  } = deps;

  if (!storage || typeof storage.isConfigured !== 'function') {
    throw new Error('[i18n] createI18nRouter requires a `storage` service (GCS-style: isConfigured/uploadFile/downloadFile/listFiles)');
  }

  const router = express.Router();
  const SUPPORTED_LANGUAGES = supportedLanguages;
  const suggestGate = suggestOpen ? (Array.isArray(optionalAuth) ? optionalAuth : [optionalAuth]) : requireTeacher;
  const SUGGEST_MODE = suggestOpen ? 'debugging' : 'normal';

  // ---- caches -------------------------------------------------------------
  const CACHE_TTL = process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : 30 * 1000;
  const translationCache = new Map();     // `translations_${lang}` -> { data, timestamp }
  const onDemandCache = new Map();         // `${lang}:${hash}` -> translation

  // Debounced GCS persistence for on-demand translations.
  const pendingTranslations = new Map();   // lang -> { hash: translation }
  let persistTimer = null;
  const PERSIST_DELAY = 10000;

  function schedulePersistToGCS() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      if (pendingTranslations.size === 0) return;
      const toPersist = new Map(pendingTranslations);
      pendingTranslations.clear();
      for (const [lang, newEntries] of toPersist) {
        try {
          if (!storage.isConfigured()) continue;
          let localeData = {};
          const cacheKey = `translations_${lang}`;
          const cached = translationCache.get(cacheKey);
          if (cached) {
            localeData = JSON.parse(JSON.stringify(cached.data));
          } else {
            try {
              const content = await storage.downloadFile(`locales/${lang}.json`);
              localeData = JSON.parse(content.toString());
            } catch (e) {
              localeData = { _meta: { language: lang }, translations: {} };
            }
          }
          if (!localeData.translations) localeData.translations = {};
          Object.assign(localeData.translations, newEntries);
          localeData._meta = localeData._meta || {};
          localeData._meta.lastUpdated = new Date().toISOString().split('T')[0];
          await storage.uploadFile(
            Buffer.from(JSON.stringify(localeData, null, 2), 'utf-8'),
            `${lang}.json`,
            { folder: 'locales', contentType: 'application/json', cacheControl: 'public, max-age=300' }
          );
          translationCache.set(cacheKey, { data: localeData, timestamp: Date.now(), source: 'gcs' });
          console.log(`[i18n] Persisted ${Object.keys(newEntries).length} on-demand translations for ${lang} to GCS`);
        } catch (err) {
          console.error(`[i18n] Failed to persist translations for ${lang}:`, err.message);
          const existing = pendingTranslations.get(lang) || {};
          pendingTranslations.set(lang, { ...newEntries, ...existing });
          schedulePersistToGCS();
        }
      }
    }, PERSIST_DELAY);
  }

  // Resolve the on-disk locales dir (public preferred, dist fallback) once.
  async function resolveLocalDir() {
    const candidates = [localesFsPath].filter(Boolean);
    for (const dir of candidates) {
      try { await fs.access(dir); return dir; } catch (e) { /* try next */ }
    }
    return null;
  }

  async function createLocaleFromTemplate(lang) {
    const dir = await resolveLocalDir();
    let englishData = { translations: {} };
    if (dir) {
      try {
        englishData = JSON.parse(await fs.readFile(path.join(dir, 'en.json'), 'utf-8'));
      } catch (e) { /* no template on disk */ }
    }
    const langConfig = SUPPORTED_LANGUAGES[lang] || { name: lang.toUpperCase(), dir: 'ltr' };
    const newLocale = {
      _meta: {
        language: lang, name: langConfig.name, direction: langConfig.dir,
        version: '1.0.0', lastUpdated: new Date().toISOString().split('T')[0],
        autoGenerated: true, basedOn: 'en'
      },
      translations: { ...(englishData.translations || {}) }
    };
    if (storage.isConfigured()) {
      try {
        await storage.uploadFile(
          Buffer.from(JSON.stringify(newLocale, null, 2), 'utf-8'),
          `${lang}.json`,
          { folder: 'locales', contentType: 'application/json', cacheControl: 'public, max-age=300' }
        );
      } catch (e) {
        console.warn(`[i18n] Failed to persist auto-created locale ${lang}:`, e.message);
      }
    }
    return newLocale;
  }

  // ======================= Locale serving ================================

  // GET /locales/:lang.json  — GCS → local fallback → auto-create
  router.get('/locales/:lang.json', async (req, res) => {
    const { lang } = req.params;
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) return res.status(400).json({ error: 'Invalid language code' });

    const cacheKey = `translations_${lang}`;
    const cached = translationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.set('X-Cache', 'HIT'); res.set('Cache-Control', 'no-cache');
      return res.json(cached.data);
    }
    try {
      if (storage.isConfigured()) {
        try {
          const content = await storage.downloadFile(`locales/${lang}.json`);
          const data = JSON.parse(content.toString());
          translationCache.set(cacheKey, { data, timestamp: Date.now(), source: 'gcs' });
          res.set('X-Cache', 'MISS'); res.set('X-Source', 'GCS'); res.set('Cache-Control', 'no-cache');
          return res.json(data);
        } catch (e) { /* fall through to local */ }
      }
      const dir = await resolveLocalDir();
      if (dir) {
        try {
          const data = JSON.parse(await fs.readFile(path.join(dir, `${lang}.json`), 'utf-8'));
          translationCache.set(cacheKey, { data, timestamp: Date.now(), source: 'local' });
          res.set('X-Cache', 'MISS'); res.set('X-Source', 'LOCAL'); res.set('Cache-Control', 'no-cache');
          return res.json(data);
        } catch (e) { /* fall through to auto-create */ }
      }
      const newLocale = await createLocaleFromTemplate(lang);
      translationCache.set(cacheKey, { data: newLocale, timestamp: Date.now(), source: 'auto-created' });
      res.set('X-Source', 'AUTO-CREATED'); res.set('Cache-Control', 'no-cache');
      return res.json(newLocale);
    } catch (error) {
      console.error('[i18n] Error fetching translations:', error);
      return res.status(500).json({ error: 'Failed to fetch translations' });
    }
  });

  // GET /languages
  router.get('/languages', async (req, res) => {
    try {
      const languages = new Set();
      if (storage.isConfigured()) {
        try {
          const files = await storage.listFiles('locales/');
          files.forEach(f => {
            const m = f.name.match(/locales\/([a-z]{2}(?:-[A-Z]{2})?)\.json$/);
            if (m) languages.add(m[1]);
          });
        } catch (e) { /* ignore */ }
      }
      const dir = await resolveLocalDir();
      if (dir) {
        try {
          (await fs.readdir(dir)).forEach(file => {
            const m = file.match(/^([a-z]{2}(?:-[A-Z]{2})?)\.json$/);
            if (m) languages.add(m[1]);
          });
        } catch (e) { /* ignore */ }
      }
      return res.json({ languages: [...languages].sort() });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to list languages' });
    }
  });

  // PUT /locales/:lang.json  (admin) — replace a whole locale file
  router.put('/locales/:lang.json', ...requireAdmin, async (req, res) => {
    const { lang } = req.params;
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) return res.status(400).json({ error: 'Invalid language code' });
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Storage not configured' });
    const translations = req.body;
    if (!translations || typeof translations !== 'object') return res.status(400).json({ error: 'Invalid translations data' });
    try {
      await storage.uploadFile(
        Buffer.from(JSON.stringify(translations, null, 2), 'utf-8'),
        `${lang}.json`,
        { folder: 'locales', contentType: 'application/json', cacheControl: 'public, max-age=300', public: true }
      );
      translationCache.delete(`translations_${lang}`);
      return res.json({ success: true, message: `Translations for ${lang} updated`, path: `locales/${lang}.json` });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to upload translations' });
    }
  });

  // POST /invalidate-cache
  router.post('/invalidate-cache', (req, res) => {
    const { lang } = req.body || {};
    if (lang) { translationCache.delete(`translations_${lang}`); return res.json({ success: true, message: `Cache invalidated for ${lang}` }); }
    translationCache.clear();
    return res.json({ success: true, message: 'All translation caches invalidated' });
  });

  // POST /translate  — on-demand LLM translation of a single string
  router.post('/translate', async (req, res) => {
    const { text, hash, targetLang } = req.body || {};
    if (!targetLang || !SUPPORTED_LANGUAGES[targetLang] || targetLang === 'en') {
      return res.status(400).json({ error: `Invalid or unsupported target language: ${targetLang || '(empty)'}` });
    }
    if (!text || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Text is required' });
    if (text.length > 2000) return res.status(400).json({ error: `Text too long: ${text.length} (max 2000)` });
    if (!hash || !/^[a-f0-9]{16}$/.test(hash)) return res.status(400).json({ error: `Invalid hash: ${hash || '(empty)'}` });

    const scriptPattern = LANG_SCRIPT_PATTERNS[targetLang];
    if (scriptPattern && scriptPattern.test(text)) return res.json({ hash, translation: text, cached: true });

    const cacheKey = `${targetLang}:${hash}`;
    if (onDemandCache.has(cacheKey)) return res.json({ hash, translation: onDemandCache.get(cacheKey), cached: true });

    const localeCached = translationCache.get(`translations_${targetLang}`);
    if (localeCached?.data) {
      const t = (localeCached.data.translations || localeCached.data)[hash];
      if (t && t !== text) { onDemandCache.set(cacheKey, t); return res.json({ hash, translation: t, cached: true }); }
    }

    if (typeof llmTranslate !== 'function') {
      return res.status(503).json({ error: 'Translation service unavailable — no llmTranslate configured' });
    }
    try {
      const languageName = SUPPORTED_LANGUAGES[targetLang].name;
      const translation = (await llmTranslate({ text, targetLang, languageName, req }) || '').trim();
      if (!translation) return res.status(500).json({ error: 'Empty translation' });
      onDemandCache.set(cacheKey, translation);
      const existing = pendingTranslations.get(targetLang) || {};
      existing[hash] = translation;
      pendingTranslations.set(targetLang, existing);
      schedulePersistToGCS();
      return res.json({ hash, translation, cached: false });
    } catch (err) {
      console.error('[i18n] On-demand translation failed:', err.message);
      return res.status(500).json({ error: 'Translation failed' });
    }
  });

  // POST /suggest-alternatives (teacher+) — a few AI-proposed alternatives for
  // the Language Suggestion modal. Needs the injected `llmSuggestAlternatives`.
  router.post('/suggest-alternatives', ...suggestGate, async (req, res) => {
    const { english, current, lang } = req.body || {};
    if (!lang || !SUPPORTED_LANGUAGES[lang] || lang === 'en') {
      return res.status(400).json({ error: `Invalid or unsupported target language: ${lang || '(empty)'}` });
    }
    const source = String(english || current || '').trim();
    if (!source) return res.status(400).json({ error: 'Nothing to translate' });
    if (source.length > 2000) return res.status(400).json({ error: `Text too long: ${source.length} (max 2000)` });
    if (typeof llmSuggestAlternatives !== 'function') {
      return res.status(503).json({ error: 'Alternatives unavailable — no llmSuggestAlternatives configured' });
    }
    try {
      const languageName = SUPPORTED_LANGUAGES[lang].name;
      const out = await llmSuggestAlternatives({ english: source, current, lang, languageName, req });
      const alternatives = (Array.isArray(out) ? out : [])
        .map(s => String(s).trim()).filter(Boolean)
        .filter((s, i, a) => a.indexOf(s) === i).slice(0, 5);
      if (!alternatives.length) return res.status(500).json({ error: 'No alternatives generated' });
      return res.json({ alternatives });
    } catch (err) {
      console.error('[i18n] suggest-alternatives failed:', err.message);
      return res.status(500).json({ error: 'Failed to generate alternatives' });
    }
  });

  // ==================== Translation Suggestion Mode ======================

  async function applyTranslationToLocale(lang, hash, translation) {
    if (!storage.isConfigured()) throw new Error('Storage not configured');
    let localeData;
    const cacheKey = `translations_${lang}`;
    const cached = translationCache.get(cacheKey);
    if (cached?.data) {
      localeData = JSON.parse(JSON.stringify(cached.data));
    } else {
      try {
        localeData = JSON.parse((await storage.downloadFile(`locales/${lang}.json`)).toString());
      } catch (e) {
        localeData = { _meta: { language: lang }, translations: {} };
      }
    }
    if (!localeData.translations) localeData.translations = {};
    localeData.translations[hash] = translation;
    localeData._meta = localeData._meta || {};
    localeData._meta.lastUpdated = new Date().toISOString().split('T')[0];
    await storage.uploadFile(
      Buffer.from(JSON.stringify(localeData, null, 2), 'utf-8'),
      `${lang}.json`,
      { folder: 'locales', contentType: 'application/json', cacheControl: 'public, max-age=300' }
    );
    translationCache.set(cacheKey, { data: localeData, timestamp: Date.now(), source: 'gcs' });
    onDemandCache.set(`${lang}:${hash}`, translation);
  }

  async function loadAllSuggestions() {
    if (!storage.isConfigured()) return [];
    let files;
    try { files = await storage.listFiles(`${SUGGESTIONS_FOLDER}/`); } catch (e) { return []; }
    const out = [];
    for (const f of files) {
      if (!f.name.endsWith('.json')) continue;
      try { out.push(JSON.parse((await storage.downloadFile(f.name)).toString())); }
      catch (e) { console.warn(`[i18n] Bad suggestion ${f.name}:`, e.message); }
    }
    out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return out;
  }
  const loadSuggestion = async (id) => JSON.parse((await storage.downloadFile(`${SUGGESTIONS_FOLDER}/${id}.json`)).toString());
  const saveSuggestion = (s) => storage.uploadFile(
    Buffer.from(JSON.stringify(s, null, 2), 'utf-8'),
    `${s.id}.json`,
    { folder: SUGGESTIONS_FOLDER, contentType: 'application/json', cacheControl: 'no-cache' }
  );

  // GET /suggest-config (public) — tells the client if suggesting is open to all.
  router.get('/suggest-config', (req, res) => {
    res.json({ mode: SUGGEST_MODE, allowAny: suggestOpen });
  });

  // POST /suggestions  (teacher+, or anyone when suggestOpen) — submit a correction
  router.post('/suggestions', ...suggestGate, async (req, res) => {
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Storage not configured' });
    const { hash, lang, english, current, suggested } = req.body || {};
    if (!hash || !/^[a-f0-9]{16}$/.test(hash)) return res.status(400).json({ error: `Invalid hash: ${hash || '(empty)'}` });
    if (!lang || !SUPPORTED_LANGUAGES[lang] || lang === 'en') return res.status(400).json({ error: `Invalid language: ${lang || '(empty)'}` });
    if (!suggested || typeof suggested !== 'string' || !suggested.trim()) return res.status(400).json({ error: 'A non-empty suggested translation is required' });
    if (suggested.length > 2000) return res.status(400).json({ error: `Suggestion too long (max 2000)` });

    const now = new Date().toISOString();
    // One entry per (lang, hash): a deterministic id means re-submitting the same
    // string overwrites its single suggestion instead of piling up duplicates.
    const id = `${lang}_${hash}`;
    let createdAt = now;
    try { const existing = await loadSuggestion(id); createdAt = existing.createdAt || now; } catch (e) { /* first time */ }
    const suggestion = {
      id, hash, lang,
      english: typeof english === 'string' ? english.slice(0, 2000) : '',
      current: typeof current === 'string' ? current.slice(0, 2000) : '',
      suggested: suggested.trim(), status: 'pending',
      submittedBy: req.user?.email || null, submittedByName: req.user?.name || null,
      createdAt, updatedAt: now, reviewedBy: null, reviewedAt: null, reviewNote: null
    };
    try { await saveSuggestion(suggestion); return res.status(201).json({ success: true, suggestion }); }
    catch (err) { console.error('[i18n] store suggestion:', err.message); return res.status(500).json({ error: 'Failed to store suggestion' }); }
  });

  // GET /suggestions?status=pending  (admin)
  router.get('/suggestions', ...requireAdmin, async (req, res) => {
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Storage not configured' });
    try {
      let suggestions = await loadAllSuggestions();
      const { status } = req.query;
      if (status && SUGGESTION_STATUSES.includes(status)) suggestions = suggestions.filter(s => s.status === status);
      const counts = suggestions.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {});
      return res.json({ suggestions, counts, total: suggestions.length });
    } catch (err) { return res.status(500).json({ error: 'Failed to list suggestions' }); }
  });

  // POST /suggestions/:id/approve  (admin) — writes into the live locale file
  router.post('/suggestions/:id/approve', ...requireAdmin, async (req, res) => {
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Storage not configured' });
    const { id } = req.params;
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return res.status(400).json({ error: 'Invalid suggestion id' });
    let s;
    try { s = await loadSuggestion(id); } catch (e) { return res.status(404).json({ error: 'Suggestion not found' }); }
    if (s.status === 'approved') return res.status(409).json({ error: 'Suggestion already approved' });
    try { await applyTranslationToLocale(s.lang, s.hash, s.suggested); }
    catch (err) { console.error('[i18n] apply approved:', err.message); return res.status(500).json({ error: 'Failed to apply translation to locale file' }); }
    s.status = 'approved'; s.reviewedBy = req.user?.email || null; s.reviewedAt = new Date().toISOString(); s.updatedAt = s.reviewedAt;
    if (typeof req.body?.note === 'string') s.reviewNote = req.body.note.slice(0, 500);
    try { await saveSuggestion(s); } catch (err) { console.warn('[i18n] applied but record update failed:', err.message); }
    return res.json({ success: true, suggestion: s });
  });

  // POST /suggestions/:id/reject  (admin)
  router.post('/suggestions/:id/reject', ...requireAdmin, async (req, res) => {
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Storage not configured' });
    const { id } = req.params;
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return res.status(400).json({ error: 'Invalid suggestion id' });
    let s;
    try { s = await loadSuggestion(id); } catch (e) { return res.status(404).json({ error: 'Suggestion not found' }); }
    s.status = 'rejected'; s.reviewedBy = req.user?.email || null; s.reviewedAt = new Date().toISOString(); s.updatedAt = s.reviewedAt;
    if (typeof req.body?.note === 'string') s.reviewNote = req.body.note.slice(0, 500);
    try { await saveSuggestion(s); return res.json({ success: true, suggestion: s }); }
    catch (err) { return res.status(500).json({ error: 'Failed to update suggestion' }); }
  });

  return router;
}

module.exports = { createI18nRouter, DEFAULT_SUPPORTED_LANGUAGES };
