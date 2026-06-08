import './env.js'; // load .env before config
import bcrypt from 'bcryptjs';
import { classify } from './ai.js';
import store from './store/gcs.js';
import { users as usersRepo, posts as postsRepo, addLoopStep, toggleReaction } from './store/repo.js';
import { authorSnapshot } from './helpers.js';

const RESET = process.argv.includes('--reset');

if (RESET) {
  const n = await store.clearPrefix('db/');
  console.log(`· cleared ${n} existing data objects`);
}

const existing = await usersRepo.all();
if (existing.length > 0 && !RESET) {
  console.log('Store already seeded. Use `npm run reset` to rebuild.');
  process.exit(0);
}

// Jing'an reference point
const BASE = { lat: 31.2304, lng: 121.4737 };
const near = (dLat, dLng) => ({ lat: BASE.lat + dLat, lng: BASE.lng + dLng });
const pw = bcrypt.hashSync('ourblock', 10);

async function mkUser(name, nameCjk, email, lat, lng, level, levelTitle, avatar) {
  return usersRepo.create({
    name, nameCjk, email, passwordHash: pw,
    neighborhood: 'Jing’an, Shanghai', lat, lng, level, levelTitle, avatar,
  });
}

const users = {
  ling: await mkUser('Ling W.', '玲', 'ling@ourblock.org', BASE.lat, BASE.lng, 3, 'Steward', '玲'),
  mei: await mkUser('Mei', '梅', 'mei@ourblock.org', BASE.lat + 0.001, BASE.lng + 0.0008, 2, 'Neighbour', '梅'),
  zhang: await mkUser('老张', '张', 'zhang@ourblock.org', BASE.lat - 0.0009, BASE.lng + 0.002, 4, 'Organiser', '张'),
  ana: await mkUser('Ana R.', null, 'ana@ourblock.org', BASE.lat + 0.0006, BASE.lng - 0.0011, 2, 'Neighbour', 'A'),
  jun: await mkUser('Jun', '俊', 'jun@ourblock.org', BASE.lat - 0.0004, BASE.lng - 0.0006, 1, 'Steward', '俊'),
};
const allUsers = Object.values(users);

const HOUR = 3600e3;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

async function mkPost(p) {
  const ai = await classify({ stream: p.stream, title: p.title, body: p.body || '' });
  const author = p.author;
  return postsRepo.create({
    userId: author.id,
    stream: p.stream,
    title: p.title,
    body: p.body || '',
    mediaType: p.mediaType || 'photo',
    mediaUrl: p.mediaUrl || null,
    durationS: p.durationS || null,
    lat: p.lat,
    lng: p.lng,
    placeName: p.placeName,
    ai: { tag: p.aiTag || ai.tag, category: ai.category, action: ai.action, confidence: ai.confidence, summary: ai.summary },
    status: p.status || 'open',
    createdAt: p.createdAt || ago(2 * HOUR),
    author: authorSnapshot(author),
  });
}

/** Spread synthetic reactions across real users (capped at pool size, so counts stay honest). */
async function seedReactions(postId, { cheer = 0, help = 0, metoo = 0 }) {
  await postsRepo.mutate(postId, (doc) => {
    const give = (type, n) => {
      for (let k = 0; k < Math.min(n, allUsers.length); k++) {
        toggleReaction(doc, { userId: allUsers[k].id, type });
      }
    };
    give('cheer', cheer);
    give('help', help);
    give('metoo', metoo);
    return doc;
  });
}

async function seedSteps(postId, steps) {
  await postsRepo.mutate(postId, (doc) => {
    for (const s of steps) addLoopStep(doc, s);
    return doc;
  });
}

// ── The Good — corner garden ─────────────────────────────────────────────────
const garden = await mkPost({
  author: users.mei, stream: 'good',
  title: 'The little corner garden is blooming again 🌼',
  body: 'Neighbours have been quietly tending the planters by Yuyuan Rd. Worth a slow walk past.',
  mediaType: 'photo', placeName: 'Yuyuan Rd', ...near(0.0011, 0.0009), createdAt: ago(2 * HOUR),
  aiTag: 'AI: pocket garden',
});
await seedReactions(garden.id, { cheer: 5, help: 3 });

// ── The Good — mural ─────────────────────────────────────────────────────────
const mural = await mkPost({
  author: users.zhang, stream: 'good',
  title: 'Volunteers repainted the underpass mural this weekend',
  body: 'Fifteen of us, two afternoons. The crossing feels completely different now.',
  mediaType: 'video', durationS: 14, placeName: 'Changping Rd', ...near(-0.0009, 0.0019), createdAt: ago(24 * HOUR),
  aiTag: 'AI: community art',
});
await seedReactions(mural.id, { cheer: 5, help: 4 });

// ── Needs Care — streetlight (routed to city) ────────────────────────────────
const light = await mkPost({
  author: users.jun, stream: 'care',
  title: 'Streetlight out by the crossing',
  body: 'The lamp at the Changping Rd crossing has been dark for three nights. Feels unsafe after 8pm.',
  mediaType: 'video', durationS: 11, placeName: 'Changping Rd', ...near(-0.0004, 0.0016),
  status: 'open', createdAt: ago(0.7 * HOUR), aiTag: 'AI: broken light',
});
await seedReactions(light.id, { metoo: 5 });
await seedSteps(light.id, [{ label: 'Reported with photo + GPS', status: 'done', detail: 'Changping Rd' }]);

// ── Needs Care — cracked pavement (in progress) ──────────────────────────────
const pavement = await mkPost({
  author: users.ling, stream: 'care',
  title: 'Cracked pavement outside the bakery',
  body: 'A widening crack has tripped two people this week. Reported with photo + GPS.',
  mediaType: 'photo', placeName: 'Wujiang Rd', ...near(0.0003, -0.0007),
  status: 'in_progress', createdAt: ago(72 * HOUR), aiTag: 'AI: cracked pavement',
});
await seedReactions(pavement.id, { metoo: 4, help: 2 });
await seedSteps(pavement.id, [
  { label: 'Reported with photo + GPS', status: 'done', detail: 'Wujiang Rd' },
  { label: 'Routed to District Works', status: 'done' },
  { label: 'In progress · ETA 3 days', status: 'active' },
]);

// ── Needs Care — litter (rally) ──────────────────────────────────────────────
const litter = await mkPost({
  author: users.ana, stream: 'care',
  title: 'Litter piling up at the canal steps',
  body: 'After the weekend market the canal steps are covered. Could we do a quick clean-up?',
  mediaType: 'photo', placeName: 'Suzhou Creek', ...near(0.0007, -0.0012),
  status: 'rallying', createdAt: ago(5 * HOUR), aiTag: 'AI: litter',
});
await seedReactions(litter.id, { metoo: 3, help: 4 });

// ── The Good — morning market ────────────────────────────────────────────────
const market = await mkPost({
  author: users.ana, stream: 'good',
  title: 'Saturday morning market is back on the lane',
  body: 'Dumplings, flowers, the knife-sharpening uncle. The lane feels alive again.',
  mediaType: 'photo', placeName: 'Wu’ai Lane', ...near(0.0005, 0.0013), createdAt: ago(6 * HOUR),
  aiTag: 'AI: neighbourhood life',
});
await seedReactions(market.id, { cheer: 5, help: 1 });

console.log('✓ seeded 5 neighbours and 6 observations into GCS');
console.log('  demo login →  ling@ourblock.org  /  ourblock');
