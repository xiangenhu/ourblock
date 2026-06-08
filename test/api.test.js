// Integration tests — drive the real Express app over HTTP.
//
// The app persists to GCS only, so these tests need a configured bucket (from .env).
// They run under a UNIQUE GCS prefix so they never touch real app data, and the
// gateway is disabled (OAUTH_ENABLED=off) so no verification emails are ever sent —
// register/login use the local bcrypt fallback. When GCS isn't configured the whole
// suite skips instead of failing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-secret';
process.env.OAUTH_ENABLED = 'off'; // local auth path — no gateway, no emails
process.env.LLM_VENDOR = 'none';   // unknown vendor → has.llm() false → deterministic keyword heuristic
process.env.GCS_PREFIX = `obtest/${process.pid}`; // isolate test data (loadEnvFile won't override a preset)

// Load .env (for GCS_BUCKET etc.) BEFORE config.js reads it. loadEnvFile leaves the
// presets above intact, so the gateway stays off and the prefix stays isolated.
await import('../server/env.js');
const { default: config } = await import('../server/config.js');
const SKIP = !config.has.gcs();

const { default: app } = await import('../server/index.js');
const store = (await import('../server/store/gcs.js')).default;

let server, base, cookie;

// Skip-aware test wrapper: when GCS isn't configured the whole suite is skipped.
const t = (name, fn) => test(name, { skip: SKIP && 'GCS not configured (set GCS_BUCKET to run integration tests)' }, fn);

before(async () => {
  if (SKIP) return;
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  if (!SKIP) await store.clearPrefix('db/').catch(() => {}); // remove this run's isolated data
});

// helper that threads the auth cookie through requests
async function req(method, url, body) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

t('health check responds', async () => {
  const { status, data } = await req('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
});

t('register creates a user and sets a session', async () => {
  const { status, data } = await req('POST', '/api/auth/register', {
    name: 'Test Neighbour', nameCjk: '试', email: 'test@block.org', password: 'secret1',
  });
  assert.equal(status, 200);
  assert.equal(data.user.email, 'test@block.org');
  assert.equal(data.user.avatar, '试');
});

t('duplicate email is rejected', async () => {
  const { status } = await req('POST', '/api/auth/register', {
    name: 'Dup', email: 'test@block.org', password: 'secret1',
  });
  assert.equal(status, 409);
});

t('short password is rejected', async () => {
  const { status } = await req('POST', '/api/auth/register', {
    name: 'Shorty', email: 'short@block.org', password: '123',
  });
  assert.equal(status, 400);
});

t('me returns the logged-in user', async () => {
  const { data } = await req('GET', '/api/auth/me');
  assert.equal(data.user.email, 'test@block.org');
});

t('creating a post requires auth', async () => {
  const saved = cookie; cookie = null;
  const { status } = await req('POST', '/api/posts', { stream: 'good', title: 'x' });
  assert.equal(status, 401);
  cookie = saved;
});

let goodId, careCityId;

t('AI routes a Good post to "self"', async () => {
  const { status, data } = await req('POST', '/api/posts', {
    stream: 'good', title: 'Corner garden is blooming', lat: 31.23, lng: 121.47, placeName: 'Yuyuan Rd',
  });
  assert.equal(status, 201);
  assert.equal(data.post.stream, 'good');
  assert.equal(data.post.ai.action, 'self', 'good stream should never route to city');
  goodId = data.post.id;
});

t('AI routes a broken streetlight to "city" and seeds a loop step', async () => {
  const { data } = await req('POST', '/api/posts', {
    stream: 'care', title: 'Streetlight out by the crossing', body: 'the lamp is dark', placeName: 'Changping Rd',
  });
  assert.equal(data.post.ai.action, 'city');
  assert.equal(data.post.loop.length, 1, 'a city-routed care item starts the loop');
  assert.equal(data.post.loop[0].status, 'done');
  careCityId = data.post.id;
});

t('reactions toggle on and off', async () => {
  let { data } = await req('POST', `/api/posts/${goodId}/react`, { type: 'cheer' });
  assert.equal(data.post.reactions.cheer, 1);
  assert.deepEqual(data.post.myReactions, ['cheer']);
  ({ data } = await req('POST', `/api/posts/${goodId}/react`, { type: 'cheer' }));
  assert.equal(data.post.reactions.cheer, 0, 'second click removes the reaction');
});

t('"me too" on a care item moves it to rallying', async () => {
  const { data } = await req('POST', `/api/posts/${careCityId}/react`, { type: 'metoo' });
  assert.equal(data.post.status, 'rallying');
});

t('the owner can advance the action loop to resolved', async () => {
  let { data } = await req('POST', `/api/posts/${careCityId}/advance`, { action: 'send_report' });
  assert.equal(data.post.status, 'routed');
  ({ data } = await req('POST', `/api/posts/${careCityId}/advance`, { action: 'in_progress' }));
  assert.equal(data.post.status, 'in_progress');
  ({ data } = await req('POST', `/api/posts/${careCityId}/advance`, { action: 'resolve' }));
  assert.equal(data.post.status, 'resolved');
  assert.ok(data.post.loop.some((s) => /Resolved/.test(s.label)));
});

t('a non-owner cannot advance someone else’s loop', async () => {
  // register a second neighbour (switches the cookie)
  await req('POST', '/api/auth/register', { name: 'Other', email: 'other@block.org', password: 'secret1' });
  const { status } = await req('POST', `/api/posts/${careCityId}/advance`, { action: 'resolve' });
  assert.equal(status, 403);
});

t('feed filters by stream', async () => {
  const { data } = await req('GET', '/api/posts?stream=good');
  assert.ok(data.posts.length >= 1);
  assert.ok(data.posts.every((p) => p.stream === 'good'));
});

t('pins endpoint returns located posts', async () => {
  const { data } = await req('GET', '/api/posts/pins');
  assert.ok(Array.isArray(data.pins));
  assert.ok(data.pins.some((p) => p.id === goodId));
});

t('comments require a body and then appear on the post', async () => {
  const empty = await req('POST', `/api/posts/${goodId}/comments`, { body: '   ' });
  assert.equal(empty.status, 400);
  await req('POST', `/api/posts/${goodId}/comments`, { body: 'Lovely!' });
  const { data } = await req('GET', `/api/posts/${goodId}`);
  assert.equal(data.comments.length, 1);
  assert.equal(data.comments[0].body, 'Lovely!');
});

t('community stats aggregate the block', async () => {
  const { data } = await req('GET', '/api/stats/community');
  assert.ok(data.neighbours >= 2);
  assert.ok(data.acts >= 1);
  assert.ok(Array.isArray(data.leaders));
});

t('my stats reflect the viewer', async () => {
  // currently logged in as "other@block.org"; log back in as the first user
  await req('POST', '/api/auth/login', { email: 'test@block.org', password: 'secret1' });
  const { status, data } = await req('GET', '/api/stats/me');
  assert.equal(status, 200);
  assert.equal(typeof data.acts, 'number');
  assert.equal(data.goal, 40);
});
