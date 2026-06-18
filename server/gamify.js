/**
 * gamify.js — the points + levels spine (see docs/redesign-youcheng-meishi.md).
 *
 * One chokepoint, `award()`, mutates a user doc: it credits `pointsEarned` (lifetime gross,
 * never decreases → drives the level) and `points` (spendable balance, which Thanks debits),
 * then recomputes level/title. Counters for season/month are NOT stored here — they are derived
 * from post/reaction timestamps in stats.js, so there is nothing to reset and no drift.
 *
 * Remove this module and the kernel still runs: every caller treats award() as best-effort.
 */
import store from './store/gcs.js';

// The first FOUNDING_LIMIT neighbours of a block are "Founding Stewards" (⑧) — granted a
// permanent badge of honour. Sequential user ids make eligibility a simple id ≤ limit check.
export const FOUNDING_LIMIT = 100;
export const isFounder = (userId) => userId != null && Number(userId) <= FOUNDING_LIMIT;

// Point values per action. Keep small and legible — this is a civic app, not a casino.
export const POINTS = {
  good: 5,        // share something good
  care: 5,        // flag something that needs care
  react: 1,       // cheer / me-too / I'll help
  confirm: 3,     // verify a neighbour's fix (待验收 → 已解决)
  resolve: 20,    // close a care loop
  thanks_give: -5, // sending Thanks costs the initiator
  thanks_get: 3,  // each thanked participant receives this
};

// Level ladder — lifetime pointsEarned thresholds. Steward → Block Legend (matches the doc).
export const LEVELS = [
  { level: 1, title: 'Steward', min: 0 },
  { level: 2, title: 'Block Friend', min: 60 },
  { level: 3, title: 'Block Keeper', min: 180 },
  { level: 4, title: 'Block Guardian', min: 400 },
  { level: 5, title: 'Block Legend', min: 900 },
];

/** The level/title for a lifetime points total, plus progress toward the next level. */
export function levelFor(pointsEarned = 0) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (pointsEarned >= l.min) cur = l;
  const next = LEVELS.find((l) => l.min > cur.min) || null;
  const span = next ? next.min - cur.min : 1;
  const into = pointsEarned - cur.min;
  return {
    level: cur.level,
    levelTitle: cur.title,
    nextTitle: next ? next.title : null,
    nextAt: next ? next.min : null,
    toNext: next ? Math.max(0, next.min - pointsEarned) : 0,
    progress: next ? Math.min(1, into / span) : 1,
  };
}

/**
 * Credit (or debit, for negative amounts) a user and recompute their level. Best-effort:
 * a missing user or a storage hiccup resolves to null rather than throwing into the route.
 *
 * @param {number|null} userId
 * @param {keyof POINTS|number} keyOrAmount  a POINTS key, or a raw signed number
 * @returns the fresh user doc, or null
 */
export async function award(userId, keyOrAmount) {
  if (userId == null) return null;
  const amount = typeof keyOrAmount === 'number' ? keyOrAmount : (POINTS[keyOrAmount] || 0);
  if (!amount) return null;
  try {
    return await store.mutate(`db/users/${userId}.json`, null, (u) => {
      if (!u) return null;
      const earned = Math.max(0, (u.pointsEarned || 0) + Math.max(0, amount));
      const balance = Math.max(0, (u.points || 0) + amount);
      const lv = levelFor(earned);
      return { ...u, pointsEarned: earned, points: balance, level: lv.level, levelTitle: lv.levelTitle };
    });
  } catch {
    return null;
  }
}

/** Add a badge to a user (idempotent). Best-effort. */
export async function grantBadge(userId, badge) {
  if (userId == null || !badge) return null;
  try {
    return await store.mutate(`db/users/${userId}.json`, null, (u) => {
      if (!u) return null;
      const badges = new Set(u.badges || []);
      if (badges.has(badge)) return u;
      badges.add(badge);
      return { ...u, badges: [...badges] };
    });
  } catch {
    return null;
  }
}

export default { POINTS, LEVELS, levelFor, award, grantBadge, FOUNDING_LIMIT, isFounder };
