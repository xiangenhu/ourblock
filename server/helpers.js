import db from './db.js';

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

const authorStmt = db.prepare(
  'SELECT id, name, name_cjk, avatar_initial, level, level_title FROM users WHERE id = ?'
);
const reactionCountStmt = db.prepare(
  `SELECT type, COUNT(*) AS n FROM reactions WHERE post_id = ? GROUP BY type`
);
const myReactionsStmt = db.prepare(
  `SELECT type FROM reactions WHERE post_id = ? AND user_id = ?`
);
const stepsStmt = db.prepare(
  `SELECT id, label, status, position, detail FROM loop_steps WHERE post_id = ? ORDER BY position`
);
const commentCountStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM comments WHERE post_id = ?`
);

/** Turn a raw post row into the API shape the frontend expects. */
export function shapePost(post, viewer) {
  const author = authorStmt.get(post.user_id);

  const counts = { cheer: 0, help: 0, metoo: 0 };
  for (const r of reactionCountStmt.all(post.id)) counts[r.type] = r.n;

  const mine = viewer
    ? myReactionsStmt.all(post.id, viewer.id).map((r) => r.type)
    : [];

  const dist =
    viewer && post.lat != null
      ? distanceMeters(viewer.lat, viewer.lng, post.lat, post.lng)
      : null;

  return {
    id: post.id,
    stream: post.stream,
    title: post.title,
    body: post.body,
    mediaType: post.media_type,
    mediaUrl: post.media_url,
    durationS: post.duration_s,
    lat: post.lat,
    lng: post.lng,
    placeName: post.place_name,
    distanceM: dist,
    ai: {
      tag: post.ai_tag,
      category: post.ai_category,
      action: post.ai_action,
      confidence: post.ai_confidence,
      summary: post.ai_summary,
    },
    status: post.status,
    createdAt: post.created_at,
    author: author
      ? {
          id: author.id,
          name: author.name,
          nameCjk: author.name_cjk,
          avatar: author.avatar_initial,
          level: author.level,
          levelTitle: author.level_title,
        }
      : null,
    reactions: counts,
    myReactions: mine,
    commentCount: commentCountStmt.get(post.id).n,
    loop: stepsStmt.all(post.id),
  };
}

export function getViewer(req) {
  if (!req.userId) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId) || null;
}
