import './env.js'; // MUST be first — loads .env before config is read
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config.js';
import { attachUser } from './auth.js';
import authRoutes from './routes/auth.js';
import postRoutes from './routes/posts.js';
import uploadRoutes, { mediaRouter } from './routes/upload.js';
import statsRoutes from './routes/stats.js';
import aiRoutes from './routes/ai.js';
import healthRouter from './routes/health.js';
import helpRoutes from './routes/help.js';
import ttsRoutes from './routes/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.set('trust proxy', true); // Cloud Run sits behind a proxy — needed for real client IPs (rate limiting)
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(attachUser);

// API
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/ai', aiRoutes); // POST /api/ai/describe — vision title/description for a photo
app.use('/api/media', mediaRouter); // GET /api/media/<file> — streams from GCS
app.use('/api/health', healthRouter);
// Contextual help — public ask/tts (used on pre-sign-in pages) + Admin-only analytics.
app.use('/api', helpRoutes); // /api/config/help-hover · /api/help/ask · /api/admin/help-analytics
app.use('/api', ttsRoutes);  // /api/tts

// Static frontend (HTML/CSS/JS only — media lives in GCS, served via /api/media).
app.use(express.static(PUBLIC_DIR));

// SPA fallback — let the client router handle non-API GETs.
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

export default app;

// Only start listening when run directly (tests import the app instead).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const PORT = config.port;
  app.listen(PORT, () => {
    console.log(`优城美市 · Our Block running on http://localhost:${PORT}`);
    console.log(
      `  integrations — gcs:${config.has.gcs() ? 'on' : 'off'} ` +
        `llm:${config.has.llm() ? config.llm.vendor : 'off'} ` +
        `lrs:${config.has.lrs() ? 'on' : 'off'} ` +
        `maps:${config.has.maps() ? 'on' : 'off'}`
    );
  });
}
