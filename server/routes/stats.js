import express from 'express';
import { requireAuth } from '../auth.js';
import { users, posts } from '../store/repo.js';
import { levelFor } from '../gamify.js';

const router = express.Router();

const reactionsOf = (p) => p.reactions || [];

// Season = calendar quarter. Spring=Jan–Mar, Summer=Apr–Jun, Autumn=Jul–Sep, Winter=Oct–Dec.
const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
function seasonInfo(d = new Date()) {
  const q = Math.floor(d.getUTCMonth() / 3); // 0..3
  const start = new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1));
  return { name: SEASON_NAMES[q], year: d.getUTCFullYear(), start, end,
    key: `season-${d.getUTCFullYear()}-${SEASON_NAMES[q].toLowerCase()}` };
}
const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** GET /api/stats/me — intrapersonal self-efficacy. */
router.get('/me', requireAuth, async (req, res) => {
  const uid = req.userId;
  const [all, me] = await Promise.all([posts.all(), users.getById(uid)]);

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

  // Three-tier act timeline (①): every act (a post I made, or a reaction I gave) carries a
  // timestamp, so lifetime / season / month are just windowed counts — nothing to reset, no drift.
  const actTimes = [
    ...mine.map((p) => p.createdAt),
    ...all.flatMap((p) => reactionsOf(p).filter((r) => r.userId === uid).map((r) => r.createdAt)),
  ].filter(Boolean);
  const season = seasonInfo();
  const mStart = monthStart().toISOString();
  const sStart = season.start.toISOString();
  const countSince = (iso) => actTimes.filter((t) => t >= iso).length;
  const seasonActs = countSince(sStart);
  const monthActs = countSince(mStart);

  // Task system (④) — daily / weekly / season missions, derived from the same act timeline.
  // `have/need` drive the progress; `done` when have ≥ need. No stored state → nothing to reset.
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 6 * 864e5); weekStart.setUTCHours(0, 0, 0, 0);
  const myReactionTimes = all.flatMap((p) => reactionsOf(p).filter((r) => r.userId === uid).map((r) => r.createdAt)).filter(Boolean);
  const sinceCount = (arr, iso) => arr.filter((t) => t >= iso).length;
  const mineSince = (iso) => mine.filter((p) => p.createdAt >= iso).length;
  const dayIso = dayStart.toISOString(), weekIso = weekStart.toISOString();
  const mkTask = (period, label, have, need) => ({ period, label, have: Math.min(have, need), need, done: have >= need });
  const tasks = [
    mkTask('daily', 'Notice one thing on your block', mineSince(dayIso), 1),
    mkTask('daily', 'Cheer or support a neighbour', sinceCount(myReactionTimes, dayIso), 1),
    mkTask('weekly', 'Capture 3 observations', mineSince(weekIso), 3),
    mkTask('weekly', 'Help close a care item', all.filter((p) => p.status === 'resolved' && p.stream === 'care' && p.userId !== uid && reactionsOf(p).some((r) => r.userId === uid && r.createdAt >= weekIso)).length, 1),
    mkTask('season', 'Reach the season goal of 40 acts', countSince(sStart), 40),
  ];

  const goal = 40; // season goal (drives the progress bar in the side panel)
  const pointsEarned = me?.pointsEarned || 0;
  const lv = levelFor(pointsEarned);
  res.json({
    // back-compat top-level fields (side panel reads acts/progress; season = current quarter)
    acts: seasonActs,
    captured,
    good,
    care,
    resolved,
    cheersReceived,
    goal,
    progress: Math.min(1, seasonActs / goal),
    points: me?.points || 0,
    pointsEarned,
    badges: me?.badges || [],
    level: lv.level,
    levelTitle: lv.levelTitle,
    nextTitle: lv.nextTitle,
    toNext: lv.toNext,
    levelProgress: lv.progress,
    // three tiers (①)
    tiers: {
      lifetime: { acts: actTimes.length, captured, resolved, points: pointsEarned, neverResets: true },
      season: { name: season.name, acts: seasonActs, goal, progress: Math.min(1, seasonActs / goal), badgeKey: season.key, endsAt: season.end.toISOString() },
      month: { acts: monthActs },
    },
    tasks,
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
