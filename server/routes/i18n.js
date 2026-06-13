/**
 * routes/i18n.js — hash-based UI translation API (see /team-i18n).
 *
 *   GET  /api/i18n/langs          -> { langs:[…], rtl:[…] }
 *   GET  /api/i18n/dict/:lang     -> { lang, dict:{ hash: text } }   (en → empty = identity)
 *   POST /api/i18n/register       body { items:[{hash,en}] } -> { ok, registered }
 *
 * register() stores English immediately and kicks off background translation through the
 * single LLM gateway, so the next dictionary fetch for any language is complete.
 */
import express from 'express';
import { getDict, registerHashes, translateAndStore, UI_LANGS, RTL_LANGS } from '../i18n.js';

const router = express.Router();

router.get('/langs', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ langs: UI_LANGS, rtl: RTL_LANGS });
});

router.get('/dict/:lang', async (req, res) => {
  const lang = String(req.params.lang || 'en').toLowerCase();
  if (lang === 'en' || !UI_LANGS.includes(lang)) return res.json({ lang, dict: {} });
  try {
    const dict = await getDict(lang);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ lang, dict });
  } catch {
    res.json({ lang, dict: {} }); // degrade to English
  }
});

router.post('/register', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 300) : [];
  if (!items.length) return res.json({ ok: true, registered: 0 });
  try {
    const fresh = await registerHashes(items);
    if (fresh.length) translateAndStore(fresh, { userId: req.userId }).catch(() => {}); // background
    res.json({ ok: true, registered: fresh.length });
  } catch (e) {
    res.status(500).json({ error: `i18n register failed: ${e.message}` });
  }
});

export default router;
