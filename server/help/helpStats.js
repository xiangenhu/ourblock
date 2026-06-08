/**
 * help/helpStats.js — frequency analytics for contextual help, on GCS.
 *
 * Every ask (hit OR miss) CAS-bumps the cache doc `cache/help:{hash}.json`:
 *   askCount++  ·  hitCount += (served === 'hit')  ·  merge analytics.
 * CAS is the GCS generation-precondition read-modify-write in store/gcs.js (ifGenerationMatch),
 * so concurrent asks about the same element never lose a count.
 *
 * The doc is keyed by a CONTENT hash, never by userId — analytics are not identity-linked
 * (see /team-privacy: a minor's free-text question is never stored tied to who they are).
 */
import store from '../store/gcs.js';

export async function bumpHelpStat(cacheKey, { served, update = {} } = {}) {
  return store.mutate(`cache/${cacheKey}.json`, null, (cur) => {
    const nowMs = Date.now();
    const base = cur || { askCount: 0, hitCount: 0, createdAtMs: nowMs };
    const next = {
      ...base,
      ...update,
      askCount: (base.askCount || 0) + 1,
      hitCount: (base.hitCount || 0) + (served === 'hit' ? 1 : 0),
      updatedAtMs: nowMs,
      updatedAt: new Date().toISOString(),
    };
    if (update.analytics) {
      next.analytics = { ...(base.analytics || {}), ...update.analytics };
    }
    return next;
  });
}

export async function listHelpStats({ limit = 500 } = {}) {
  return store.listByPrefix('cache/help:', { limit });
}

export default { bumpHelpStat, listHelpStats };
