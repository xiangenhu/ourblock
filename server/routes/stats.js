import express from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';

const router = express.Router();

/** GET /api/stats/me — intrapersonal self-efficacy. */
router.get('/me', requireAuth, (req, res) => {
  const uid = req.userId;
  const acts =
    db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?').get(uid).n +
    db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE user_id = ?').get(uid).n;
  const captured = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?').get(uid).n;
  const good = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE user_id=? AND stream='good'").get(uid).n;
  const care = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE user_id=? AND stream='care'").get(uid).n;

  // Items the viewer helped get resolved: they reacted to (or authored) a now-resolved care item.
  const resolved = db
    .prepare(
      `SELECT COUNT(DISTINCT p.id) AS n FROM posts p
       WHERE p.status='resolved' AND p.stream='care'
         AND (p.user_id = ? OR p.id IN (SELECT post_id FROM reactions WHERE user_id = ?))`
    )
    .get(uid, uid).n;

  const cheersReceived = db
    .prepare(
      `SELECT COUNT(*) AS n FROM reactions r JOIN posts p ON p.id=r.post_id
       WHERE p.user_id=? AND r.type='cheer'`
    )
    .get(uid).n;

  // Season goal of 40 acts (drives the progress bar in the side panel).
  const goal = 40;
  res.json({
    acts,
    captured,
    good,
    care,
    resolved,
    cheersReceived,
    goal,
    progress: Math.min(1, acts / goal),
  });
});

/** GET /api/stats/community — collective efficacy for the block. */
router.get('/community', (_req, res) => {
  const acts =
    db.prepare('SELECT COUNT(*) AS n FROM posts').get().n +
    db.prepare('SELECT COUNT(*) AS n FROM reactions').get().n;
  const neighbours = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const places = db
    .prepare('SELECT COUNT(DISTINCT COALESCE(place_name, id)) AS n FROM posts')
    .get().n;
  const resolved = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status='resolved'").get().n;
  const good = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE stream='good'").get().n;
  const care = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE stream='care'").get().n;

  const leaders = db
    .prepare(
      `SELECT u.name, u.name_cjk, u.avatar_initial AS avatar,
              COUNT(p.id) AS posts
       FROM users u LEFT JOIN posts p ON p.user_id=u.id
       GROUP BY u.id ORDER BY posts DESC, u.id LIMIT 5`
    )
    .all();

  res.json({
    acts,
    neighbours,
    places,
    resolved,
    good,
    care,
    changePct: 31, // vs last month — illustrative trend used by the panel
    leaders,
  });
});

export default router;
