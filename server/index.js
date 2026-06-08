import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { attachUser } from './auth.js';
import authRoutes from './routes/auth.js';
import postRoutes from './routes/posts.js';
import uploadRoutes from './routes/upload.js';
import statsRoutes from './routes/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(attachUser);

// API
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stats', statsRoutes);
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Our Block' }));

// Static frontend (+ uploaded media)
app.use(express.static(PUBLIC_DIR));

// SPA fallback — let the client router handle non-API GETs.
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

export default app;

// Only start listening when run directly (tests import the app instead).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`优城美市 · Our Block running on http://localhost:${PORT}`);
  });
}
