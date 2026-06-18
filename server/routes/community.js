/**
 * routes/community.js — verified official/property accounts (①) + the Block Pulse dashboard (②).
 *
 * Officials are an additive, server-derived role (like the admin allowlist): a resident applies,
 * an admin verifies. Once `role==='official' && verified`, the posts loop already lets them
 * claim/advance any care item (see routes/posts.js advance gates). Remove this file and the
 * civic loop is unchanged.
 */
import express from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { users, posts } from '../store/repo.js';
import store from '../store/gcs.js';
import { levelFor } from '../gamify.js';

const router = express.Router();
const reactionsOf = (p) => p.reactions || [];

/* ── Official accounts (①) ──────────────────────────────────────────────── */

/** A resident applies to run a verified official/property account. */
router.post('/apply-official', requireAuth, async (req, res) => {
  const { orgName } = req.body || {};
  if (!orgName || !orgName.trim()) return res.status(400).json({ error: 'Tell us the organisation name.' });
  const updated = await store.mutate(`db/users/${req.userId}.json`, null, (u) => {
    if (!u) return null;
    u.orgRequest = { orgName: String(orgName).trim().slice(0, 80), at: new Date().toISOString() };
    return u;
  });
  if (!updated) return res.status(404).json({ error: 'User not found.' });
  res.json({ ok: true, pending: true });
});

/** Admin: list pending applications + currently-verified officials. */
router.get('/officials', requireAdmin, async (_req, res) => {
  const everyone = await users.all();
  const slim = (u) => ({ id: u.id, name: u.name, email: u.email, orgName: u.orgName || u.orgRequest?.orgName || null, verified: !!u.verified, requestedAt: u.orgRequest?.at || null });
  res.json({
    pending: everyone.filter((u) => u.orgRequest && !u.verified).map(slim),
    verified: everyone.filter((u) => u.role === 'official' && u.verified).map(slim),
  });
});

/** Admin: verify (or revoke) an official/property account. */
router.post('/verify-official', requireAdmin, async (req, res) => {
  const { userId, orgName, revoke } = req.body || {};
  if (userId == null) return res.status(400).json({ error: 'Which account?' });
  const updated = await store.mutate(`db/users/${Number(userId)}.json`, null, (u) => {
    if (!u) return null;
    if (revoke) { u.role = 'resident'; u.verified = false; return u; }
    u.role = 'official';
    u.verified = true;
    u.orgName = (orgName || u.orgRequest?.orgName || u.name || '').toString().slice(0, 80);
    u.orgRequest = null;
    return u;
  });
  if (!updated) return res.status(404).json({ error: 'Account not found.' });
  res.json({ ok: true, userId: Number(userId), verified: !revoke });
});

/* ── Block Pulse (②) — the three-E dashboard in one query ──────────────────── */

router.get('/pulse', async (_req, res) => {
  const [all, everyone] = await Promise.all([posts.all(), users.all()]);
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const dayIso = dayStart.toISOString();

  // Active today = distinct neighbours who posted or reacted since midnight UTC.
  const activeIds = new Set();
  for (const p of all) {
    if (p.userId != null && p.createdAt >= dayIso) activeIds.add(p.userId);
    for (const r of reactionsOf(p)) if (r.userId != null && r.createdAt >= dayIso) activeIds.add(r.userId);
  }

  const care = all.filter((p) => p.stream === 'care');
  const sortNew = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);

  // Latest solved stories (④) — resolved care items that produced a narrative.
  const stories = care
    .filter((p) => p.status === 'resolved' && p.story)
    .sort((a, b) => ((a.verify?.at || a.createdAt) < (b.verify?.at || b.createdAt) ? 1 : -1))
    .slice(0, 4)
    .map((p) => ({ id: p.id, title: p.title, placeName: p.placeName, story: p.story }));

  // Open issues still needing help.
  const open = care
    .filter((p) => !['resolved'].includes(p.status))
    .sort(sortNew)
    .slice(0, 6)
    .map((p) => ({ id: p.id, title: p.title, placeName: p.placeName, status: p.status, claimed: !!p.claim, groups: p.groups || [] }));

  // Contribution ranking by lifetime points.
  const ranking = everyone
    .map((u) => ({ id: u.id, name: u.name, nameCjk: u.nameCjk, avatarSeed: u.avatarSeed ?? null, official: u.role === 'official' && u.verified, orgName: u.orgName || null, points: u.pointsEarned || 0, level: levelFor(u.pointsEarned || 0).level }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 6);

  res.json({
    activeToday: activeIds.size,
    neighbours: everyone.length,
    openCount: care.filter((p) => p.status !== 'resolved').length,
    resolvedCount: care.filter((p) => p.status === 'resolved').length,
    stories,
    open,
    ranking,
  });
});

export default router;
