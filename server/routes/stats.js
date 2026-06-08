import express from 'express';
import { requireAuth } from '../auth.js';
import { users, posts } from '../store/repo.js';

const router = express.Router();

const reactionsOf = (p) => p.reactions || [];

/** GET /api/stats/me — intrapersonal self-efficacy. */
router.get('/me', requireAuth, async (req, res) => {
  const uid = req.userId;
  const all = await posts.all();

  const mine = all.filter((p) => p.userId === uid);
  const myReactions = all.reduce(
    (n, p) => n + reactionsOf(p).filter((r) => r.userId === uid).length,
    0
  );
  const acts = mine.length + myReactions;
  const captured = mine.length;
  const good = mine.filter((p) => p.stream === 'good').length;
  const care = mine.filter((p) => p.stream === 'care').length;

  // Care items the viewer helped close: authored, or reacted to, a now-resolved care item.
  const resolved = all.filter(
    (p) =>
      p.status === 'resolved' &&
      p.stream === 'care' &&
      (p.userId === uid || reactionsOf(p).some((r) => r.userId === uid))
  ).length;

  // Cheers received on the viewer's own posts.
  const cheersReceived = mine.reduce(
    (n, p) => n + reactionsOf(p).filter((r) => r.type === 'cheer').length,
    0
  );

  const goal = 40; // season goal (drives the progress bar in the side panel)
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
router.get('/community', async (_req, res) => {
  const [all, everyone] = await Promise.all([posts.all(), users.all()]);

  const totalReactions = all.reduce((n, p) => n + reactionsOf(p).length, 0);
  const acts = all.length + totalReactions;
  const neighbours = everyone.length;
  const places = new Set(all.map((p) => p.placeName || `post:${p.id}`)).size;
  const resolved = all.filter((p) => p.status === 'resolved').length;
  const good = all.filter((p) => p.stream === 'good').length;
  const care = all.filter((p) => p.stream === 'care').length;

  const postsByUser = new Map();
  for (const p of all) postsByUser.set(p.userId, (postsByUser.get(p.userId) || 0) + 1);
  const leaders = everyone
    .map((u) => ({
      name: u.name,
      nameCjk: u.nameCjk,
      avatar: u.avatar,
      posts: postsByUser.get(u.id) || 0,
    }))
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 5);

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
