/**
 * upload.js — media in/out, GCS-only (no local disk; works on Cloud Run).
 *
 *   POST /api/upload            multipart "media" -> stores bytes at media/<uuid>.<ext>,
 *                               returns { url: "/api/media/<uuid>.<ext>", mediaType, size }
 *   GET  /api/media/<file>      streams the object back from GCS (bucket stays private)
 *
 * Multer buffers into memory (capped at 60 MB) rather than writing to disk; the buffer is
 * handed straight to GCS. The bucket is never public — viewers read through the proxy below.
 * Public URLs carry only the <file> name; the GCS key is always media/<file>, so the proxy
 * can never be coaxed into reading db/ objects.
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { requireAuth } from '../auth.js';
import store from '../store/gcs.js';

const MEDIA_PREFIX = 'media/';
const SAFE_NAME = /^[A-Za-z0-9._-]+$/; // uuid + short extension only

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB — short videos & photos
  fileFilter: (_req, file, cb) => {
    const ok = /^(image|video)\//.test(file.mimetype);
    cb(ok ? null : new Error('Only image and video files are allowed.'), ok);
  },
});

const router = express.Router();

router.post('/', requireAuth, (req, res) => {
  upload.single('media')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    try {
      const ext = path.extname(req.file.originalname).toLowerCase().slice(0, 6).replace(/[^.a-z0-9]/g, '');
      const name = `${crypto.randomUUID()}${ext}`;
      await store.putBuffer(MEDIA_PREFIX + name, req.file.buffer, req.file.mimetype);
      const mediaType = req.file.mimetype.startsWith('video') ? 'video' : 'photo';
      res.json({ url: `/api/media/${name}`, mediaType, size: req.file.size });
    } catch (e) {
      res.status(502).json({ error: `Upload failed: ${e.message}` });
    }
  });
});

export default router;

/** Media proxy — mounted at /api/media in index.js. :name is the file under media/. */
export const mediaRouter = express.Router();

mediaRouter.get('/:name', async (req, res) => {
  const { name } = req.params;
  if (!SAFE_NAME.test(name)) return res.status(400).json({ error: 'Bad media key.' });
  try {
    const obj = await store.getStream(MEDIA_PREFIX + name);
    if (!obj) return res.status(404).json({ error: 'Not found.' });
    res.setHeader('Content-Type', obj.contentType);
    if (obj.size) res.setHeader('Content-Length', obj.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // content-addressed name
    obj.stream.on('error', () => { if (!res.headersSent) res.status(502).end(); }).pipe(res);
  } catch (e) {
    res.status(502).json({ error: `Media read failed: ${e.message}` });
  }
});
