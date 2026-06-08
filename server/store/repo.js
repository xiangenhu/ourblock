/**
 * store/repo.js — the data model, expressed as GCS objects (storage invariant: GCS-only).
 *
 * Key layout (the "schema" is the folder/key design):
 *   db/seq/{name}.json              -> { value }            monotonic id source (CAS)
 *   db/users/{id}.json              -> user doc (incl. passwordHash)
 *   db/users-by-email.json          -> { [emailLower]: id } login index (CAS)
 *   db/posts/{id}.json              -> self-contained post doc (reactions/comments/loop inline)
 *   media/{uuid}.{ext}              -> raw photo/video bytes (see routes/upload.js)
 *
 * A post doc carries everything the feed and detail views need, so listing the feed is a
 * single prefix scan with NO per-post sub-reads. Mutations that race (reactions, comments,
 * loop steps) use store.mutate() (generation-precondition CAS).
 */
import crypto from 'crypto';
import store from './gcs.js';

const nowIso = () => new Date().toISOString();

// ── id sequence ──────────────────────────────────────────────────────────────
async function nextId(name) {
  const doc = await store.mutate(`db/seq/${name}.json`, { value: 0 }, (d) => ({ value: (d.value || 0) + 1 }));
  return doc.value;
}

// ── users ────────────────────────────────────────────────────────────────────
const EMAIL_INDEX = 'db/users-by-email.json';

export const users = {
  async create(u) {
    const id = await nextId('users');
    const email = String(u.email).trim().toLowerCase();
    const doc = {
      id,
      name: u.name,
      nameCjk: u.nameCjk ?? null,
      email,
      passwordHash: u.passwordHash,
      neighborhood: u.neighborhood ?? 'Jing’an, Shanghai',
      lat: u.lat ?? 31.2304,
      lng: u.lng ?? 121.4737,
      level: u.level ?? 1,
      levelTitle: u.levelTitle ?? 'Steward',
      avatar: u.avatar ?? '·',
      createdAt: nowIso(),
    };
    await store.set(`db/users/${id}.json`, doc);
    await store.mutate(EMAIL_INDEX, {}, (idx) => ({ ...idx, [email]: id }));
    return doc;
  },

  async getById(id) {
    if (id == null) return null;
    return store.get(`db/users/${id}.json`);
  },

  async findByEmail(email) {
    const idx = (await store.get(EMAIL_INDEX)) || {};
    const id = idx[String(email).trim().toLowerCase()];
    return id ? users.getById(id) : null;
  },

  async all() {
    const rows = await store.listByPrefix('db/users/');
    return rows.map((r) => r.doc).filter(Boolean);
  },
};

// ── posts ────────────────────────────────────────────────────────────────────
export const posts = {
  async create(p) {
    const id = await nextId('posts');
    const doc = {
      id,
      userId: p.userId,
      stream: p.stream,
      title: p.title,
      body: p.body || '',
      mediaType: p.mediaType === 'video' ? 'video' : 'photo',
      mediaUrl: p.mediaUrl || null,
      durationS: p.durationS || null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      placeName: p.placeName || null,
      ai: p.ai || { tag: null, category: null, action: null, confidence: null, summary: null },
      status: p.status || 'open',
      createdAt: p.createdAt || nowIso(),
      author: p.author || null, // snapshot {id,name,nameCjk,avatar,level,levelTitle}
      reactions: [], // { userId, type, createdAt }
      comments: [], // { id, userId, body, createdAt, authorName, avatar }
      loop: [], // { id, label, status, position, detail, createdAt }
      seq: { comment: 0, loop: 0 },
    };
    await store.set(`db/posts/${id}.json`, doc);
    return doc;
  },

  async getById(id) {
    if (id == null) return null;
    return store.get(`db/posts/${id}.json`);
  },

  async all() {
    const rows = await store.listByPrefix('db/posts/', { limit: 5000 });
    return rows.map((r) => r.doc).filter(Boolean);
  },

  /** CAS read-modify-write on a single post. transform(doc) must return the new doc. */
  async mutate(id, transform) {
    let touched = false;
    const next = await store.mutate(`db/posts/${id}.json`, null, (doc) => {
      if (doc == null) return null; // missing → leave absent
      touched = true;
      return transform(doc);
    });
    return touched ? next : null;
  },

  async del(id) {
    return store.del(`db/posts/${id}.json`);
  },
};

// Helpers the routes use to mutate inline collections (id allocation kept inside the doc).
export function addComment(doc, { userId, body, authorName, avatar }) {
  doc.seq.comment += 1;
  doc.comments.push({ id: doc.seq.comment, userId, body, authorName, avatar, createdAt: nowIso() });
  return doc;
}

export function addLoopStep(doc, { label, status = 'active', detail = null }) {
  // previous active step becomes done
  for (const s of doc.loop) if (s.status === 'active') s.status = 'done';
  doc.seq.loop += 1;
  const position = doc.loop.length;
  doc.loop.push({ id: doc.seq.loop, label, status, position, detail, createdAt: nowIso() });
  return doc;
}

export function toggleReaction(doc, { userId, type }) {
  const i = doc.reactions.findIndex((r) => r.userId === userId && r.type === type);
  let added;
  if (i >= 0) {
    doc.reactions.splice(i, 1);
    added = false;
  } else {
    doc.reactions.push({ userId, type, createdAt: nowIso() });
    added = true;
  }
  return added;
}

export const newMediaKey = (ext = '') => `media/${crypto.randomUUID()}${ext}`;

export default { users, posts, nextId, addComment, addLoopStep, toggleReaction, newMediaKey };
