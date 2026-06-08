import bcrypt from 'bcryptjs';
import db from './db.js';
import { classify } from './ai.js';

const RESET = process.argv.includes('--reset');

if (RESET) {
  db.exec('DELETE FROM comments; DELETE FROM loop_steps; DELETE FROM reactions; DELETE FROM posts; DELETE FROM users;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','posts','reactions','loop_steps','comments');");
  console.log('· cleared existing data');
}

const already = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (already > 0 && !RESET) {
  console.log('Database already seeded. Use `npm run reset` to rebuild.');
  process.exit(0);
}

// Jing'an reference point
const BASE = { lat: 31.2304, lng: 121.4737 };
const near = (dLat, dLng) => ({ lat: BASE.lat + dLat, lng: BASE.lng + dLng });

const pw = bcrypt.hashSync('ourblock', 10);
const mkUser = db.prepare(
  `INSERT INTO users (name, name_cjk, email, password_hash, neighborhood, lat, lng, level, level_title, avatar_initial)
   VALUES (?,?,?,?,?,?,?,?,?,?)`
);

const users = {
  ling: mkUser.run('Ling W.', '玲', 'ling@ourblock.org', pw, "Jing'an, Shanghai", BASE.lat, BASE.lng, 3, 'Steward', '玲').lastInsertRowid,
  mei: mkUser.run('Mei', '梅', 'mei@ourblock.org', pw, "Jing'an, Shanghai", BASE.lat + 0.001, BASE.lng + 0.0008, 2, 'Neighbour', '梅').lastInsertRowid,
  zhang: mkUser.run('老张', '张', 'zhang@ourblock.org', pw, "Jing'an, Shanghai", BASE.lat - 0.0009, BASE.lng + 0.002, 4, 'Organiser', '张').lastInsertRowid,
  ana: mkUser.run('Ana R.', null, 'ana@ourblock.org', pw, "Jing'an, Shanghai", BASE.lat + 0.0006, BASE.lng - 0.0011, 2, 'Neighbour', 'A').lastInsertRowid,
  jun: mkUser.run('Jun', '俊', 'jun@ourblock.org', pw, "Jing'an, Shanghai", BASE.lat - 0.0004, BASE.lng - 0.0006, 1, 'Steward', '俊').lastInsertRowid,
};

const allUsers = Object.values(users);

async function mkPost(p) {
  const ai = await classify({ stream: p.stream, title: p.title, body: p.body || '' });
  const info = db
    .prepare(
      `INSERT INTO posts
       (user_id, stream, title, body, media_type, media_url, duration_s, lat, lng, place_name,
        ai_tag, ai_category, ai_action, ai_confidence, ai_summary, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now', ?))`
    )
    .run(
      p.user_id, p.stream, p.title, p.body || '', p.mediaType || 'photo', p.mediaUrl || null,
      p.durationS || null, p.lat, p.lng, p.placeName,
      p.aiTag || ai.tag, ai.category, ai.action, ai.confidence, ai.summary,
      p.status || 'open', p.age || '-2 hours'
    );
  return info.lastInsertRowid;
}

const react = db.prepare('INSERT OR IGNORE INTO reactions (post_id, user_id, type) VALUES (?,?,?)');
function seedReactions(postId, { cheer = 0, help = 0, metoo = 0 }) {
  // spread synthetic reactions across users (cycling) to reach the target counts
  const pool = allUsers;
  let i = 0;
  const give = (type, n) => {
    for (let k = 0; k < n; k++) {
      react.run(postId, pool[i % pool.length], type);
      i++;
    }
  };
  // Only have 5 real users; cap to pool size so counts are honest in the DB,
  // the display counts are padded by a base offset stored separately is overkill —
  // instead we just seed up to pool size and let the UI show live counts.
  give('cheer', Math.min(cheer, pool.length));
  i = 0;
  give('help', Math.min(help, pool.length));
  i = 0;
  give('metoo', Math.min(metoo, pool.length));
}

const steps = db.prepare(
  'INSERT INTO loop_steps (post_id, label, status, position, detail) VALUES (?,?,?,?,?)'
);

const run = async () => {
  // The Good — corner garden
  const garden = await mkPost({
    user_id: users.mei, stream: 'good',
    title: 'The little corner garden is blooming again 🌼',
    body: 'Neighbours have been quietly tending the planters by Yuyuan Rd. Worth a slow walk past.',
    mediaType: 'photo', placeName: 'Yuyuan Rd', ...near(0.0011, 0.0009), age: '-2 hours',
    aiTag: 'AI: pocket garden',
  });
  seedReactions(garden, { cheer: 5, help: 3 });

  // The Good — mural
  const mural = await mkPost({
    user_id: users.zhang, stream: 'good',
    title: 'Volunteers repainted the underpass mural this weekend',
    body: 'Fifteen of us, two afternoons. The crossing feels completely different now.',
    mediaType: 'video', durationS: 14, placeName: 'Changping Rd', ...near(-0.0009, 0.0019), age: '-1 day',
    aiTag: 'AI: community art',
  });
  seedReactions(mural, { cheer: 5, help: 4 });

  // Needs Care — streetlight (routed to city)
  const light = await mkPost({
    user_id: users.jun, stream: 'care',
    title: 'Streetlight out by the crossing',
    body: 'The lamp at the Changping Rd crossing has been dark for three nights. Feels unsafe after 8pm.',
    mediaType: 'video', durationS: 11, placeName: 'Changping Rd', ...near(-0.0004, 0.0016),
    status: 'open', age: '-40 minutes', aiTag: 'AI: broken light',
  });
  seedReactions(light, { metoo: 5 });
  steps.run(light, 'Reported with photo + GPS', 'done', 0, 'Changping Rd');

  // Needs Care — cracked pavement (the loop-status example, in progress)
  const pavement = await mkPost({
    user_id: users.ling, stream: 'care',
    title: 'Cracked pavement outside the bakery',
    body: 'A widening crack has tripped two people this week. Reported with photo + GPS.',
    mediaType: 'photo', placeName: 'Wujiang Rd', ...near(0.0003, -0.0007),
    status: 'in_progress', age: '-3 days', aiTag: 'AI: cracked pavement',
  });
  seedReactions(pavement, { metoo: 4, help: 2 });
  steps.run(pavement, 'Reported with photo + GPS', 'done', 0, 'Wujiang Rd');
  steps.run(pavement, 'Routed to District Works', 'done', 1, null);
  steps.run(pavement, 'In progress · ETA 3 days', 'active', 2, null);

  // Needs Care — litter (rally)
  const litter = await mkPost({
    user_id: users.ana, stream: 'care',
    title: 'Litter piling up at the canal steps',
    body: 'After the weekend market the canal steps are covered. Could we do a quick clean-up?',
    mediaType: 'photo', placeName: 'Suzhou Creek', ...near(0.0007, -0.0012),
    status: 'rallying', age: '-5 hours', aiTag: 'AI: litter',
  });
  seedReactions(litter, { metoo: 3, help: 4 });

  // The Good — morning market
  const market = await mkPost({
    user_id: users.ana, stream: 'good',
    title: 'Saturday morning market is back on the lane',
    body: 'Dumplings, flowers, the knife-sharpening uncle. The lane feels alive again.',
    mediaType: 'photo', placeName: "Wu'ai Lane", ...near(0.0005, 0.0013), age: '-6 hours',
    aiTag: 'AI: neighbourhood life',
  });
  seedReactions(market, { cheer: 5, help: 1 });

  console.log('✓ seeded 5 neighbours and 6 observations');
  console.log('  demo login →  ling@ourblock.org  /  ourblock');
};

run();
