import express from 'express';
import { requireAuth } from '../auth.js';
import { classify } from '../ai.js';
import { posts, addComment, addLoopStep, toggleReaction } from '../store/repo.js';
import { shapePost, getViewer, distanceMeters, authorSnapshot } from '../helpers.js';
import events from '../xapi/events.js';

const router = express.Router();

/**
 * GET /api/posts
 * Query: stream=good|care, sort=new|near|top, radius=<metres>, mine=1, status=<status>,
 *        limit, offset
 * The feed is a single GCS prefix scan (post docs are self-contained); filtering, sorting
 * and pagination happen in memory.
 */
router.get('/', async (req, res) => {
  const viewer = await getViewer(req);
  const { stream, sort = 'new', radius, mine, status } = req.query;

  let all = await posts.all();

  if (stream === 'good' || stream === 'care') all = all.filter((p) => p.stream === stream);
  if (status) all = all.filter((p) => p.status === status);
  if (mine === '1' && viewer) all = all.filter((p) => p.userId === viewer.id);

  let shaped = all.map((p) => shapePost(p, viewer));

  // radius filter (metres) — only meaningful with a located viewer
  const r = radius ? Number(radius) : null;
  if (r && viewer) shaped = shaped.filter((p) => p.distanceM == null || p.distanceM <= r);

  if (sort === 'near') {
    shaped.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
  } else if (sort === 'top') {
    const score = (p) => p.reactions.cheer + p.reactions.help + p.reactions.metoo;
    shaped.sort((a, b) => score(b) - score(a));
  } else {
    shaped.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const total = shaped.length;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const page = shaped.slice(offset, offset + limit);

  res.json({
    posts: page,
    total,
    hasMore: offset + limit < total,
    viewer: viewer ? { lat: viewer.lat, lng: viewer.lng } : null,
  });
});

/** Lightweight pins for the map. */
router.get('/pins', async (req, res) => {
  const viewer = await getViewer(req);
  const all = await posts.all();
  const pins = all
    .filter((p) => p.lat != null)
    .map((p) => ({
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

router.get('/:id', async (req, res) => {
  const viewer = await getViewer(req);
  const post = await posts.getById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });
  const comments = [...(post.comments || [])]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: c.authorName, avatar: c.avatar }));
  if (viewer) events.viewedPost(viewer, post);
  res.json({ post: shapePost(post, viewer), comments });
});

/** Create an observation. AI routes it to the lowest viable rung of action. */
router.post('/', requireAuth, async (req, res) => {
  const { stream, title, body, mediaType, mediaUrl, durationS, lat, lng, placeName } = req.body || {};
  if (!['good', 'care'].includes(stream))
    return res.status(400).json({ error: 'Pick a stream: good or care.' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'Add a short title.' });

  const viewer = await getViewer(req);
  const ai = await classify({ stream, title, body, userId: req.userId });

  const post = await posts.create({
    userId: req.userId,
    stream,
    title: title.trim(),
    body: body || '',
    mediaType,
    mediaUrl: mediaUrl || null,
    durationS: durationS || null,
    lat: lat ?? null,
    lng: lng ?? null,
    placeName: placeName || null,
    ai: {
      tag: ai.tag,
      category: ai.category,
      action: ai.action,
      confidence: ai.confidence,
      summary: ai.summary,
    },
    status: 'open',
    author: authorSnapshot(viewer),
  });

  // For care items routed to the city, seed the first loop step automatically.
  if (stream === 'care' && ai.action === 'city') {
    await posts.mutate(post.id, (doc) => {
      addLoopStep(doc, { label: 'Reported with photo + GPS', status: 'done', detail: placeName || null });
      return doc;
    });
  }

  const fresh = await posts.getById(post.id);
  events.postCreated(viewer, fresh);
  res.status(201).json({ post: shapePost(fresh, viewer) });
});

/** Toggle a reaction (cheer / help / metoo). */
router.post('/:id/react', requireAuth, async (req, res) => {
  const { type } = req.body || {};
  if (!['cheer', 'help', 'metoo'].includes(type))
    return res.status(400).json({ error: 'Unknown reaction.' });

  let added = false;
  const fresh = await posts.mutate(req.params.id, (doc) => {
    added = toggleReaction(doc, { userId: req.userId, type });
    // "Me too here" on a care item nudges it toward rallying.
    if (added && type === 'metoo' && doc.status === 'open') doc.status = 'rallying';
    return doc;
  });
  if (!fresh) return res.status(404).json({ error: 'Not found.' });

  const viewer = await getViewer(req);
  if (added) events.reacted(viewer, fresh, type);
  res.json({ post: shapePost(fresh, viewer) });
});

/** Advance the action loop (send report, mark progress, resolve). */
router.post('/:id/advance', requireAuth, async (req, res) => {
  const post = await posts.getById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });
  if (post.userId !== req.userId)
    return res.status(403).json({ error: 'Only the reporter can advance this loop.' });

  const { action } = req.body || {};
  const known = ['send_report', 'in_progress', 'resolve'];
  if (!known.includes(action)) return res.status(400).json({ error: 'Unknown action.' });

  const fresh = await posts.mutate(req.params.id, (doc) => {
    if (action === 'send_report') {
      const agency = doc.ai?.category ? `District Works (${doc.ai.category})` : 'District Works';
      if ((doc.loop || []).length === 0) {
        addLoopStep(doc, { label: 'Reported with photo + GPS', status: 'done', detail: doc.placeName });
      }
      addLoopStep(doc, { label: `Routed to ${agency}`, status: 'active' });
      doc.status = 'routed';
    } else if (action === 'in_progress') {
      addLoopStep(doc, { label: 'In progress · ETA 3 days', status: 'active' });
      doc.status = 'in_progress';
    } else if (action === 'resolve') {
      addLoopStep(doc, { label: 'Resolved · loop closed', status: 'done' });
      doc.status = 'resolved';
    }
    return doc;
  });

  const viewer = await getViewer(req);
  events.loopAdvanced(viewer, fresh, action, action === 'resolve');
  res.json({ post: shapePost(fresh, viewer) });
});

router.post('/:id/comments', requireAuth, async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Write something first.' });
  const viewer = await getViewer(req);
  const fresh = await posts.mutate(req.params.id, (doc) => {
    addComment(doc, {
      userId: req.userId,
      body: body.trim(),
      authorName: viewer?.name || 'Neighbour',
      avatar: viewer?.avatar || '·',
    });
    return doc;
  });
  if (!fresh) return res.status(404).json({ error: 'Not found.' });
  res.status(201).json({ ok: true });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const post = await posts.getById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });
  if (post.userId !== req.userId)
    return res.status(403).json({ error: 'You can only remove your own posts.' });
  await posts.del(req.params.id);
  res.json({ ok: true });
});

export default router;
