import { users } from './store/repo.js';

/** Haversine distance in metres. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Turn a stored post doc into the API shape the frontend expects.
 * Pure: the doc is self-contained (author snapshot + reactions/comments/loop inline),
 * so no GCS reads happen here — the feed shapes its whole page from memory.
 */
export function shapePost(post, viewer) {
  const counts = { cheer: 0, help: 0, metoo: 0 };
  for (const r of post.reactions || []) {
    if (counts[r.type] != null) counts[r.type] += 1;
  }

  const mine = viewer
    ? (post.reactions || []).filter((r) => r.userId === viewer.id).map((r) => r.type)
    : [];

  const dist =
    viewer && post.lat != null
      ? distanceMeters(viewer.lat, viewer.lng, post.lat, post.lng)
      : null;

  const loop = [...(post.loop || [])]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, label: s.label, status: s.status, position: s.position, detail: s.detail }));

  return {
    id: post.id,
    stream: post.stream,
    title: post.title,
    body: post.body,
    mediaType: post.mediaType,
    mediaUrl: post.mediaUrl,
    durationS: post.durationS,
    lat: post.lat,
    lng: post.lng,
    placeName: post.placeName,
    distanceM: dist,
    mood: post.mood ?? null,
    groups: post.groups ?? [],
    claim: post.claim ?? null,
    verify: post.verify ?? null,
    story: post.story ?? null,
    thanks: (post.thanks || []).length,
    thankedByMe: viewer ? (post.thanks || []).some((t) => t.fromId === viewer.id) : false,
    ai: {
      tag: post.ai?.tag ?? null,
      category: post.ai?.category ?? null,
      action: post.ai?.action ?? null,
      confidence: post.ai?.confidence ?? null,
      summary: post.ai?.summary ?? null,
    },
    status: post.status,
    createdAt: post.createdAt,
    author: post.author
      ? {
          id: post.author.id,
          name: post.author.name,
          nameCjk: post.author.nameCjk,
          avatar: post.author.avatar,
          level: post.author.level,
          levelTitle: post.author.levelTitle,
        }
      : null,
    reactions: counts,
    myReactions: mine,
    commentCount: (post.comments || []).length,
    loop,
  };
}

/** Resolve the logged-in user doc from req.userId (set by attachUser). Async (GCS read). */
export async function getViewer(req) {
  if (!req.userId) return null;
  return (await users.getById(req.userId)) || null;
}

/** Snapshot the denormalized author fields stored on each post. */
export function authorSnapshot(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    nameCjk: user.nameCjk,
    avatar: user.avatar,
    level: user.level,
    levelTitle: user.levelTitle,
  };
}
