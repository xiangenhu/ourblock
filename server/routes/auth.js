import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { sign, setAuthCookie, clearAuthCookie, requireAuth } from '../auth.js';

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    nameCjk: u.name_cjk,
    email: u.email,
    neighborhood: u.neighborhood,
    lat: u.lat,
    lng: u.lng,
    level: u.level,
    levelTitle: u.level_title,
    avatar: u.avatar_initial,
  };
}

router.post('/register', (req, res) => {
  const { name, email, password, nameCjk, neighborhood } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });
  if (String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'That email is already registered.' });

  const hash = bcrypt.hashSync(password, 10);
  const initial = (nameCjk || name).trim().charAt(0).toUpperCase();
  const info = db
    .prepare(
      `INSERT INTO users (name, name_cjk, email, password_hash, neighborhood, avatar_initial, level, level_title)
       VALUES (?,?,?,?,?,?,1,'Steward')`
    )
    .run(name, nameCjk || null, email, hash, neighborhood || "Jing'an, Shanghai", initial);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = sign(user);
  setAuthCookie(res, token);
  res.json({ user: publicUser(user), token });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash))
    return res.status(401).json({ error: 'Wrong email or password.' });

  const token = sign(user);
  setAuthCookie(res, token);
  res.json({ user: publicUser(user), token });
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.userId) return res.json({ user: null });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: user ? publicUser(user) : null });
});

// Update the viewer's "current location" so the feed can be re-anchored.
router.put('/me/location', requireAuth, (req, res) => {
  const { lat, lng, neighborhood } = req.body || {};
  db.prepare('UPDATE users SET lat = COALESCE(?,lat), lng = COALESCE(?,lng), neighborhood = COALESCE(?,neighborhood) WHERE id = ?')
    .run(lat ?? null, lng ?? null, neighborhood ?? null, req.userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: publicUser(user) });
});

export default router;
