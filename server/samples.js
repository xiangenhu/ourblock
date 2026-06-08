/**
 * samples.js — a few hardcoded showcase posts for the public landing page.
 *
 * These are NOT persisted to GCS and are never mutable — they exist only to make the
 * landing page feel alive before a neighbourhood has any real posts. Each carries
 * `sample: true` so the UI can label it and disable actions (reactions/comments).
 *
 * `offset` lets the client drop each sample pin near the visitor's real location when
 * geolocation is granted; `lat`/`lng` are the fallback used before that.
 */

// A pleasant fallback centre (used only until the visitor shares their location).
const BASE = { lat: 1.3000, lng: 103.8500 };

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

/** Shape a sample so it matches the feed's post shape (see helpers.shapePost). */
function sample(s) {
  return {
    id: s.id,
    sample: true,
    stream: s.stream,
    title: s.title,
    body: s.body,
    mediaType: 'photo',
    mediaUrl: `/img/${s.id}.svg`, // themed illustration bundled in public/img
    durationS: null,
    lat: BASE.lat + s.offset.dLat,
    lng: BASE.lng + s.offset.dLng,
    offset: s.offset, // client re-places this near the visitor when located
    placeName: s.placeName,
    distanceM: null,
    ai: { tag: s.tag, category: s.category, action: s.action, confidence: 0.8, summary: s.summary },
    status: s.status || 'open',
    createdAt: hoursAgo(s.hoursAgo),
    author: { id: null, name: s.author, nameCjk: null, avatar: s.avatar, level: null, levelTitle: 'Neighbour' },
    reactions: s.reactions || { cheer: 0, help: 0, metoo: 0 },
    myReactions: [],
    commentCount: s.commentCount || 0,
    loop: s.loop || [],
  };
}

export const SAMPLES = [
  sample({
    id: 'sample-good-1', stream: 'good',
    title: 'Corner planters are blooming again',
    body: 'Neighbours have quietly been tending the little planters by the bakery — worth a slow walk past this week.',
    placeName: 'Baker’s Corner', offset: { dLat: 0.0011, dLng: 0.0009 }, hoursAgo: 3,
    tag: 'AI: pocket garden', category: 'greenery', action: 'self', author: 'A neighbour', avatar: '✿',
    summary: 'A small joy worth savouring — share it so others notice it too.',
    reactions: { cheer: 6, help: 2, metoo: 0 }, commentCount: 2,
  }),
  sample({
    id: 'sample-good-2', stream: 'good',
    title: 'Saturday market is back on the lane',
    body: 'Dumplings, flowers, and the knife-sharpening uncle. The whole lane feels alive again on weekend mornings.',
    placeName: 'Market Lane', offset: { dLat: 0.0005, dLng: 0.0014 }, hoursAgo: 6,
    tag: 'AI: neighbourhood life', category: 'gathering', action: 'self', author: 'A neighbour', avatar: '◎',
    summary: 'Community life worth celebrating — savour and share.',
    reactions: { cheer: 8, help: 1, metoo: 0 }, commentCount: 1,
  }),
  sample({
    id: 'sample-care-1', stream: 'care',
    title: 'Streetlight out by the crossing',
    body: 'The lamp at the main crossing has been dark for three nights — feels unsafe after 8pm. Reported with photo + GPS.',
    placeName: 'Main Crossing', offset: { dLat: -0.0004, dLng: 0.0016 }, hoursAgo: 1,
    tag: 'AI: broken light', category: 'lighting', action: 'city', status: 'open', author: 'A neighbour', avatar: '△',
    summary: 'Drafted a report for District Works (Lighting). Log in to send it — or rally neighbours first.',
    reactions: { cheer: 0, help: 1, metoo: 5 }, commentCount: 3,
    loop: [{ id: 1, label: 'Reported with photo + GPS', status: 'done', position: 0, detail: 'Main Crossing' }],
  }),
  sample({
    id: 'sample-care-2', stream: 'care',
    title: 'Litter piling up at the canal steps',
    body: 'After the weekend the canal steps are covered. Could a few of us do a quick clean-up this week?',
    placeName: 'Canal Steps', offset: { dLat: 0.0007, dLng: -0.0012 }, hoursAgo: 5,
    tag: 'AI: litter', category: 'waste', action: 'rally', status: 'rallying', author: 'A neighbour', avatar: '△',
    summary: 'Looks like something neighbours can take on together. Log in to rally a few people nearby.',
    reactions: { cheer: 0, help: 4, metoo: 3 }, commentCount: 1,
  }),
];

export function sampleList() {
  // Return fresh copies so callers can't mutate the module state.
  return SAMPLES.map((s) => ({ ...s }));
}
