// Integration tests — drive the real Express app over HTTP against an
// isolated temp database. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Point the DB at a throwaway file BEFORE importing anything that opens it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DB = path.join(os.tmpdir(), `ourblock-test-${process.pid}.db`);
process.env.OURBLOCK_DB = TMP_DB;
process.env.JWT_SECRET = 'test-secret';

const { default: app } = await import('../server/index.js');

let server, base, cookie;

before(async () => {
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(TMP_DB + ext, { force: true });
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

test('health check responds', async () => {
  const { status, data } = await req('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
});

test('register creates a user and sets a session', async () => {
  const { status, data } = await req('POST', '/api/auth/register', {
    name: 'Test Neighbour', nameCjk: '试', email: 'test@block.org', password: 'secret1',
  });
  assert.equal(status, 200);
  assert.equal(data.user.email, 'test@block.org');
  assert.equal(data.user.avatar, '试');
});

test('duplicate email is rejected', async () => {
  const { status } = await req('POST', '/api/auth/register', {
    name: 'Dup', email: 'test@block.org', password: 'secret1',
  });
  assert.equal(status, 409);
});

test('short password is rejected', async () => {
  const { status } = await req('POST', '/api/auth/register', {
    name: 'Shorty', email: 'short@block.org', password: '123',
  });
  assert.equal(status, 400);
});

test('me returns the logged-in user', async () => {
  const { data } = await req('GET', '/api/auth/me');
  assert.equal(data.user.email, 'test@block.org');
});

test('creating a post requires auth', async () => {
  const saved = cookie; cookie = null;
  const { status } = await req('POST', '/api/posts', { stream: 'good', title: 'x' });
  assert.equal(status, 401);
  cookie = saved;
});

let goodId, careCityId;

test('AI routes a Good post to "self"', async () => {
  const { status, data } = await req('POST', '/api/posts', {
    stream: 'good', title: 'Corner garden is blooming', lat: 31.23, lng: 121.47, placeName: 'Yuyuan Rd',
  });
  assert.equal(status, 201);
  assert.equal(data.post.stream, 'good');
  assert.equal(data.post.ai.action, 'self', 'good stream should never route to city');
  goodId = data.post.id;
});

test('AI routes a broken streetlight to "city" and seeds a loop step', async () => {
  const { data } = await req('POST', '/api/posts', {
    stream: 'care', title: 'Streetlight out by the crossing', body: 'the lamp is dark', placeName: 'Changping Rd',
  });
  assert.equal(data.post.ai.action, 'city');
  assert.equal(data.post.loop.length, 1, 'a city-routed care item starts the loop');
  assert.equal(data.post.loop[0].status, 'done');
  careCityId = data.post.id;
});

test('reactions toggle on and off', async () => {
  let { data } = await req('POST', `/api/posts/${goodId}/react`, { type: 'cheer' });
  assert.equal(data.post.reactions.cheer, 1);
  assert.deepEqual(data.post.myReactions, ['cheer']);
  ({ data } = await req('POST', `/api/posts/${goodId}/react`, { type: 'cheer' }));
  assert.equal(data.post.reactions.cheer, 0, 'second click removes the reaction');
});

test('"me too" on a care item moves it to rallying', async () => {
  const { data } = await req('POST', `/api/posts/${careCityId}/react`, { type: 'metoo' });
  assert.equal(data.post.status, 'rallying');
});

test('the owner can advance the action loop to resolved', async () => {
  let { data } = await req('POST', `/api/posts/${careCityId}/advance`, { action: 'send_report' });
  assert.equal(data.post.status, 'routed');
  ({ data } = await req('POST', `/api/posts/${careCityId}/advance`, { action: 'in_progress' }));
  assert.equal(data.post.status, 'in_progress');
  ({ data } = await req('POST', `/api/posts/${careCityId}/advance`, { action: 'resolve' }));
  assert.equal(data.post.status, 'resolved');
  assert.ok(data.post.loop.some((s) => /Resolved/.test(s.label)));
});

test('a non-owner cannot advance someone else’s loop', async () => {
  // register a second neighbour (switches the cookie)
  await req('POST', '/api/auth/register', { name: 'Other', email: 'other@block.org', password: 'secret1' });
  const { status } = await req('POST', `/api/posts/${careCityId}/advance`, { action: 'resolve' });
  assert.equal(status, 403);
});

test('feed filters by stream', async () => {
  const { data } = await req('GET', '/api/posts?stream=good');
  assert.ok(data.posts.length >= 1);
  assert.ok(data.posts.every((p) => p.stream === 'good'));
});

test('pins endpoint returns located posts', async () => {
  const { data } = await req('GET', '/api/posts/pins');
  assert.ok(Array.isArray(data.pins));
  assert.ok(data.pins.some((p) => p.id === goodId));
});

test('comments require a body and then appear on the post', async () => {
  const empty = await req('POST', `/api/posts/${goodId}/comments`, { body: '   ' });
  assert.equal(empty.status, 400);
  await req('POST', `/api/posts/${goodId}/comments`, { body: 'Lovely!' });
  const { data } = await req('GET', `/api/posts/${goodId}`);
  assert.equal(data.comments.length, 1);
  assert.equal(data.comments[0].body, 'Lovely!');
});

test('community stats aggregate the block', async () => {
  const { data } = await req('GET', '/api/stats/community');
  assert.ok(data.neighbours >= 2);
  assert.ok(data.acts >= 1);
  assert.ok(Array.isArray(data.leaders));
});

test('my stats reflect the viewer', async () => {
  // currently logged in as "other@block.org"; log back in as the first user
  await req('POST', '/api/auth/login', { email: 'test@block.org', password: 'secret1' });
  const { status, data } = await req('GET', '/api/stats/me');
  assert.equal(status, 200);
  assert.equal(typeof data.acts, 'number');
  assert.equal(data.goal, 40);
});
