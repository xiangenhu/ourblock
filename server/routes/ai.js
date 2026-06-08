/**
 * routes/ai.js — on-demand AI helpers for the capture flow.
 *
 *   POST /api/ai/describe   multipart "media" (image) [+ "stream"] -> { title, description }
 *
 * The image is buffered in memory and forwarded to the vision model through the single
 * LLM gateway — it is NOT stored in GCS here (the real upload happens on post submit).
 */
import express from 'express';
import multer from 'multer';
import { requireAuth } from '../auth.js';
import { describeImage } from '../ai.js';

const isImage = (m) => /^image\//.test(m || '');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB — a single still is plenty
  fileFilter: (_req, file, cb) => cb(isImage(file.mimetype) ? null : new Error('Only images can be described.'), isImage(file.mimetype)),
});

const router = express.Router();

router.post('/describe', requireAuth, (req, res) => {
  upload.single('media')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image received.' });
    try {
      const out = await describeImage({
        base64: req.file.buffer.toString('base64'),
        mediaType: req.file.mimetype,
        stream: req.body?.stream === 'good' ? 'good' : 'care',
        userId: req.userId,
      });
      if (!out) return res.status(503).json({ error: 'AI description is unavailable right now.' });
      res.json(out);
    } catch (e) {
      res.status(502).json({ error: `Describe failed: ${e.message}` });
    }
  });
});

export default router;
