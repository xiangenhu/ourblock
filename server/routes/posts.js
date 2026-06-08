import express from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { classify } from '../ai.js';
import { shapePost, getViewer, distanceMeters } from '../helpers.js';

const router = express.Router();

/**
 * GET /api/posts
 * Query: stream=good|care, sort=new|near|top, radius=<metres>, mine=1, status=<status>
 * Location-aware: when the viewer has coordinates, results can be filtered to a
 * radius and sorted by distance ("within 1.2 km" in the design).
 */
router.get('/', (req, res) => {
  const viewer = getViewer(req);
  const { stream, sort = 'new', radius, mine, status } = req.query;

  const where = [];
  const params = [];
  if (stream === 'good' || stream === 'care') {
    where.push('stream = ?');
    params.push(stream);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (mine === '1' && viewer) {
    where.push('user_id = ?');
    params.push(viewer.id);
  }

  const sql = `SELECT * FROM posts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  let rows = db.prepare(sql).all(...params);
  let posts = rows.map((p) => shapePost(p, viewer));

  // radius filter (metres) — only meaningful with a located viewer
  const r = radius ? Number(radius) : null;
  if (r && viewer) posts = posts.filter((p) => p.distanceM == null || p.distanceM <= r);

  if (sort === 'near') {
    posts.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
  } else if (sort === 'top') {
    const score = (p) => p.reactions.cheer + p.reactions.help + p.reactions.metoo;
    posts.sort((a, b) => score(b) - score(a));
  } else {
    posts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const total = posts.length;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const page = posts.slice(offset, offset + limit);

  res.json({
    posts: page,
    total,
    hasMore: offset + limit < total,
    viewer: viewer ? { lat: viewer.lat, lng: viewer.lng } : null,
  });
});

/** Lightweight pins for the map. */
router.get('/pins', (req, res) => {
  const viewer = getViewer(req);
  const rows = db
    .prepare('SELECT id, stream, lat, lng, title, status FROM posts WHERE lat IS NOT NULL')
    .all();
  const pins = rows.map((p) => ({
    id: p.id,
    stream: p.stream,
    lat: p.lat,
    lng: p.lng,
    title: p.title,
    status: p.status,
    distanceM: viewer ? distanceMeters(viewer.lat, viewer.lng, p.lat, p.lng) : null,
  }));
  res.json({ pins, viewer: viewer ? { lat: viewer.lat, lng: viewer.lng } : null });
});

router.get('/:id', (req, res) => {
  const viewer = getViewer(req);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });
  const shaped = shapePost(post, viewer);
  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, u.name, u.avatar_initial
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at`
    )
    .all(post.id)
    .map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, author: c.name, avatar: c.avatar_initial }));
  res.json({ post: shaped, comments });
});

/** Create an observation. AI routes it to the lowest viable rung of action. */
router.post('/', requireAuth, async (req, res) => {
  const { stream, title, body, mediaType, mediaUrl, durationS, lat, lng, placeName } =
    req.body || {};
  if (!['good', 'care'].includes(stream))
    return res.status(400).json({ error: 'Pick a stream: good or care.' });
  if (!title || !title.trim())
    return res.status(400).json({ error: 'Add a short title.' });

  const ai = await classify({ stream, title, body });

  const info = db
    .prepare(
      `INSERT INTO posts
       (user_id, stream, title, body, media_type, media_url, duration_s, lat, lng, place_name,
        ai_tag, ai_category, ai_action, ai_confidence, ai_summary, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      req.userId,
      stream,
      title.trim(),
      body || '',
      mediaType === 'video' ? 'video' : 'photo',
      mediaUrl || null,
      durationS || null,
      lat ?? null,
      lng ?? null,
      placeName || null,
      ai.tag,
      ai.category,
      ai.action,
      ai.confidence,
      ai.summary,
      'open'
    );

  // For care items routed to the city, seed the first loop step automatically.
  if (stream === 'care' && ai.action === 'city') {
    db.prepare(
      `INSERT INTO loop_steps (post_id, label, status, position, detail)
       VALUES (?, 'Reported with photo + GPS', 'done', 0, ?)`
    ).run(info.lastInsertRowid, placeName || null);
  }

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  const viewer = getViewer(req);
  res.status(201).json({ post: shapePost(post, viewer) });
});

/** Toggle a reaction (cheer / help / metoo). */
router.post('/:id/react', requireAuth, (req, res) => {
  const { type } = req.body || {};
  if (!['cheer', 'help', 'metoo'].includes(type))
    return res.status(400).json({ error: 'Unknown reaction.' });
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });

  const existing = db
    .prepare('SELECT id FROM reactions WHERE post_id = ? AND user_id = ? AND type = ?')
    .get(post.id, req.userId, type);
  if (existing) {
    db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO reactions (post_id, user_id, type) VALUES (?,?,?)').run(
      post.id,
      req.userId,
      type
    );
    // "Me too here" on a care item nudges it toward rallying.
    if (type === 'metoo' && post.status === 'open') {
      db.prepare("UPDATE posts SET status = 'rallying' WHERE id = ?").run(post.id);
    }
  }
  const fresh = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  res.json({ post: shapePost(fresh, getViewer(req)) });
});

/** Advance the action loop (send report, mark progress, resolve). */
router.post('/:id/advance', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });
  if (post.user_id !== req.userId)
    return res.status(403).json({ error: 'Only the reporter can advance this loop.' });

  const { action } = req.body || {};
  const addStep = (label, detail) => {
    const pos =
      (db.prepare('SELECT MAX(position) AS m FROM loop_steps WHERE post_id = ?').get(post.id)
        .m ?? -1) + 1;
    // previous active step becomes done
    db.prepare("UPDATE loop_steps SET status='done' WHERE post_id=? AND status='active'").run(post.id);
    db.prepare(
      'INSERT INTO loop_steps (post_id, label, status, position, detail) VALUES (?,?,?,?,?)'
    ).run(post.id, label, 'active', pos, detail || null);
  };

  if (action === 'send_report') {
    const agency = post.ai_category ? `District Works (${post.ai_category})` : 'District Works';
    if (db.prepare('SELECT COUNT(*) AS n FROM loop_steps WHERE post_id=?').get(post.id).n === 0) {
      db.prepare(
        `INSERT INTO loop_steps (post_id,label,status,position,detail) VALUES (?, 'Reported with photo + GPS','done',0,?)`
      ).run(post.id, post.place_name);
    }
    addStep(`Routed to ${agency}`, null);
    db.prepare("UPDATE posts SET status='routed' WHERE id=?").run(post.id);
  } else if (action === 'in_progress') {
    addStep('In progress · ETA 3 days', null);
    db.prepare("UPDATE posts SET status='in_progress' WHERE id=?").run(post.id);
  } else if (action === 'resolve') {
    db.prepare("UPDATE loop_steps SET status='done' WHERE post_id=? AND status='active'").run(post.id);
    const pos =
      (db.prepare('SELECT MAX(position) AS m FROM loop_steps WHERE post_id = ?').get(post.id)
        .m ?? -1) + 1;
    db.prepare(
      "INSERT INTO loop_steps (post_id,label,status,position) VALUES (?, 'Resolved · loop closed','done',?)"
    ).run(post.id, pos);
    db.prepare("UPDATE posts SET status='resolved' WHERE id=?").run(post.id);
  } else {
    return res.status(400).json({ error: 'Unknown action.' });
  }

  const fresh = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  res.json({ post: shapePost(fresh, getViewer(req)) });
});

router.post('/:id/comments', requireAuth, (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Write something first.' });
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });
  db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?,?,?)').run(
    post.id,
    req.userId,
    body.trim()
  );
  res.status(201).json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });
  if (post.user_id !== req.userId)
    return res.status(403).json({ error: 'You can only remove your own posts.' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

export default router;
