/**
 * routes/ai.js — on-demand AI helpers for the capture flow.
 *
 *   GET  /api/ai/styles?lang=zh   -> { lang, styles: [{ id, label, hint }] }
 *   POST /api/ai/describe   multipart: optional "media" (image) + optional "note" + "stream"
 *                           + optional "lang" + "style"
 *                           -> { title, description }   (a styled rewrite when "style" is set)
 *
 * Composes a title + short description from a photo and/or the neighbour's note via the
 * single LLM gateway, optionally in a culturally-iconic voice (see ai-styles.js). The image
 * is buffered in memory and never stored here (the real upload happens on post submit). Open
 * to guests so anonymous "The Good" posts can use it.
 */
import express from 'express';
import multer from 'multer';
import { composePost } from '../ai.js';
import { getStyles } from '../ai-styles.js';

const isImage = (m) => /^image\//.test(m || '');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB — a single still is plenty
  fileFilter: (_req, file, cb) => cb(isImage(file.mimetype) ? null : new Error('Only images can be described.'), isImage(file.mimetype)),
});

const router = express.Router();

// The localised list of writing-style chips for a language (labels only; prompts stay server-side).
router.get('/styles', (req, res) => {
  const { lang, styles } = getStyles(req.query.lang);
  res.setHeader('Cache-Control', 'public, max-age=3600'); // the catalog is static
  res.json({ lang, styles: styles.map(({ id, label, hint }) => ({ id, label, hint })) });
});

router.post('/describe', (req, res) => {
  upload.single('media')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const note = (req.body?.note || '').trim();
    if (!req.file && !note) return res.status(400).json({ error: 'Add a photo or a short note.' });
    try {
      const out = await composePost({
        base64: req.file ? req.file.buffer.toString('base64') : null,
        mediaType: req.file?.mimetype,
        note,
        stream: req.body?.stream === 'good' ? 'good' : 'care',
        lang: (req.body?.lang || '').trim() || undefined,
        style: (req.body?.style || '').trim() || undefined,
        userId: req.userId, // present only when signed in; used for token accounting
      });
      if (!out) return res.status(503).json({ error: 'AI is unavailable right now.' });
      res.json(out);
    } catch (e) {
      res.status(502).json({ error: `Compose failed: ${e.message}` });
    }
  });
});

export default router;
