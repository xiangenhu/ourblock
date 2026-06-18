import express from 'express';
import { requireAuth, isAdminEmail } from '../auth.js';
import { classify, resolutionStory } from '../ai.js';
import { posts, users, addComment, addLoopStep, toggleReaction } from '../store/repo.js';
import { shapePost, getViewer, distanceMeters, authorSnapshot } from '../helpers.js';
import { award } from '../gamify.js';
import events from '../xapi/events.js';

// Anonymous "The Good" posts carry this guest author (no account, no stable id).
const GUEST_AUTHOR = { id: null, name: 'A neighbour', nameCjk: null, avatar: '◎', level: null, levelTitle: 'Guest' };

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

/**
 * Create an observation. AI routes it to the lowest viable rung of action.
 *
 * Auth rule: "Needs Care" requires a signed-in neighbour. "The Good" may be posted
 * anonymously (a guest sharing a good thing), but only with a real location attached.
 */
router.post('/', async (req, res) => {
  const { stream, title, body, mediaType, mediaUrl, durationS, lat, lng, placeName, mood, groups } = req.body || {};
  if (!['good', 'care'].includes(stream))
    return res.status(400).json({ error: 'Pick a stream: good or care.' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'Add a short title.' });
  // Every observation is anchored to a place — location must be turned on.
  if (lat == null || lng == null)
    return res.status(400).json({ error: 'Turn on location to post to the block.' });

  const viewer = await getViewer(req);
  // "Needs Care" requires a signed-in neighbour; "The Good" may be posted anonymously.
  if (!viewer && stream !== 'good')
    return res.status(401).json({ error: 'Sign in to flag something that needs care.' });
  // A photo is required as evidence for every observation.
  if (!mediaUrl)
    return res.status(400).json({ error: 'Add a photo as evidence before posting.' });

  const ai = await classify({ stream, title, body, userId: req.userId });

  const MOODS = ['happy', 'neutral', 'sad', 'angry', 'anxious'];
  const CONCERN_GROUPS = ['elderly', 'children', 'disabled', 'low_income', 'newcomers', 'pets', 'commuters', 'everyone'];
  const cleanMood = MOODS.includes(mood) ? mood : null;
  const cleanGroups = Array.isArray(groups) ? [...new Set(groups)].filter((g) => CONCERN_GROUPS.includes(g)).slice(0, 4) : [];

  const post = await posts.create({
    userId: req.userId || null,
    stream,
    title: title.trim(),
    body: body || '',
    mediaType,
    mediaUrl: mediaUrl || null,
    durationS: durationS || null,
    lat: lat ?? null,
    lng: lng ?? null,
    placeName: placeName || null,
    mood: cleanMood,
    groups: cleanGroups,
    ai: {
      tag: ai.tag,
      category: ai.category,
      action: ai.action,
      confidence: ai.confidence,
      summary: ai.summary,
    },
    status: 'open',
    author: viewer ? authorSnapshot(viewer) : { ...GUEST_AUTHOR },
  });

  // For care items routed to the city, seed the first loop step automatically.
  if (stream === 'care' && ai.action === 'city') {
    await posts.mutate(post.id, (doc) => {
      addLoopStep(doc, { label: 'Reported with photo + GPS', status: 'done', detail: placeName || null });
      return doc;
    });
  }

  const fresh = await posts.getById(post.id);
  if (viewer) {
    events.postCreated(viewer, fresh); // xAPI is actor-scoped; skip for guests
    await award(viewer.id, stream === 'good' ? 'good' : 'care');
  }
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
  if (added) { events.reacted(viewer, fresh, type); await award(req.userId, 'react'); }
  res.json({ post: shapePost(fresh, viewer) });
});

/**
 * Thanks (⑤) — after a care item is resolved, its reporter may thank the neighbours who
 * helped. Costs the giver 5 points; each distinct helper (reacted/commented, not the giver)
 * receives 3. Recorded on the post so the Pulse feed can broadcast it. Idempotent-ish: a
 * giver can only thank once per post.
 */
router.post('/:id/thank', requireAuth, async (req, res) => {
  const post = await posts.getById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });
  if (post.userId !== req.userId)
    return res.status(403).json({ error: 'Only the reporter can send thanks.' });
  if (post.status !== 'resolved')
    return res.status(400).json({ error: 'You can thank helpers once this is resolved.' });
  if ((post.thanks || []).some((t) => t.fromId === req.userId))
    return res.status(400).json({ error: 'You already thanked your helpers here.' });

  const giver = await users.getById(req.userId);
  if ((giver?.points || 0) < 5)
    return res.status(400).json({ error: 'You need 5 points to send thanks.' });

  // Helpers = distinct non-giver neighbours who reacted or commented.
  const helperIds = new Set();
  for (const r of post.reactions || []) if (r.userId && r.userId !== req.userId) helperIds.add(r.userId);
  for (const c of post.comments || []) if (c.userId && c.userId !== req.userId) helperIds.add(c.userId);
  if (!helperIds.size) return res.status(400).json({ error: 'No helpers to thank yet.' });

  const at = new Date().toISOString();
  const fresh = await posts.mutate(req.params.id, (doc) => {
    doc.thanks = doc.thanks || [];
    for (const toId of helperIds) doc.thanks.push({ fromId: req.userId, toId, at });
    return doc;
  });

  await award(req.userId, 'thanks_give');                 // −5 to the giver
  for (const toId of helperIds) await award(toId, 'thanks_get'); // +3 each helper

  const viewer = await getViewer(req);
  res.json({ post: shapePost(fresh, viewer), thanked: helperIds.size });
});

/**
 * Advance the care loop (③). Closure ladder:
 *   open(待认领) → claimed(处理中) → pending_verify(待验收) → resolved(已解决)
 *
 * Actions:
 *   claim       — a neighbour or official takes it on (open → claimed)
 *   submit_fix  — the handler marks the fix done, ready for check (claimed → pending_verify)
 *   verify      — someone other than the handler confirms it (pending_verify → resolved)
 *   resolve     — reporter (or official) closes directly, skipping verification
 *   send_report / in_progress — legacy routing steps, kept for back-compat (reporter/official)
 */
router.post('/:id/advance', requireAuth, async (req, res) => {
  const post = await posts.getById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });

  const { action } = req.body || {};
  const known = ['claim', 'submit_fix', 'verify', 'send_report', 'in_progress', 'resolve'];
  if (!known.includes(action)) return res.status(400).json({ error: 'Unknown action.' });

  const viewer = await getViewer(req);
  const isReporter = post.userId === req.userId;
  const isOfficial = viewer?.role === 'official' && viewer?.verified;
  const isHandler = post.claim?.userId === req.userId;
  const name = viewer?.nameCjk || viewer?.name || 'A neighbour';

  // Permission gates per action.
  const can = {
    claim: !post.claim || isReporter || isOfficial,        // open items, or re-claim by reporter/official
    submit_fix: isHandler || isReporter || isOfficial,
    verify: !isHandler || isReporter || isOfficial,        // a fresh pair of eyes (not the handler), reporter, or official
    send_report: isReporter || isOfficial,
    in_progress: isReporter || isOfficial,
    resolve: isReporter || isOfficial,
  };
  if (!can[action]) return res.status(403).json({ error: 'You can’t take that step on this item.' });

  const at = new Date().toISOString();
  const fresh = await posts.mutate(req.params.id, (doc) => {
    if ((doc.loop || []).length === 0)
      addLoopStep(doc, { label: 'Reported with photo + GPS', status: 'done', detail: doc.placeName });

    if (action === 'claim') {
      doc.claim = { userId: req.userId, name, official: isOfficial, at };
      addLoopStep(doc, { label: `${isOfficial ? '🏢 ' : ''}Claimed by ${name}`, status: 'active' });
      doc.status = 'claimed';
    } else if (action === 'submit_fix') {
      addLoopStep(doc, { label: 'Fix submitted · awaiting a neighbour’s check', status: 'active' });
      doc.status = 'pending_verify';
    } else if (action === 'verify') {
      doc.verify = { userId: req.userId, name, at };
      addLoopStep(doc, { label: `✓ Verified resolved by ${name}`, status: 'done' });
      doc.status = 'resolved';
    } else if (action === 'send_report') {
      const agency = doc.ai?.category ? `District Works (${doc.ai.category})` : 'District Works';
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

  const closed = action === 'resolve' || action === 'verify';
  events.loopAdvanced(viewer, fresh, action, closed);
  let withStory = fresh;
  if (closed) {
    await award(fresh.userId, 'resolve');                          // the reporter's loop closed
    if (action === 'verify' && !isReporter) await award(req.userId, 'confirm'); // reward the verifier
    // Auto-generate a "solved story" (④) once, making the collective effort visible.
    if (!fresh.story) {
      const story = await resolutionStory({
        title: fresh.title,
        placeName: fresh.placeName,
        reporter: fresh.author?.nameCjk || fresh.author?.name || null,
        handler: fresh.claim?.name || null,
        verifier: fresh.verify?.name || null,
        lang: /[一-鿿]/.test(`${fresh.title}${fresh.body || ''}`) ? 'zh' : 'en',
      });
      withStory = (await posts.mutate(req.params.id, (doc) => { doc.story = story; return doc; })) || fresh;
    }
  }
  res.json({ post: shapePost(withStory, viewer) });
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

// The owner can remove their own post; an admin (TEACHER_EMAILS) can remove any post.
router.delete('/:id', requireAuth, async (req, res) => {
  const post = await posts.getById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found.' });
  if (post.userId !== req.userId) {
    const me = await users.getById(req.userId);
    if (!isAdminEmail(me?.email))
      return res.status(403).json({ error: 'You can only remove your own posts.' });
  }
  await posts.del(req.params.id);
  res.json({ ok: true });
});

export default router;
