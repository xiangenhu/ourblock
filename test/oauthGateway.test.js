// Hermetic unit tests for the OAuth/SMTP gateway client.
// fetch is stubbed — no network, no GCS, no emails sent.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.OAUTH_GATEWAY_URL = 'https://gw.example';
const { oauthGateway } = await import('../server/oauthGateway.js');

const realFetch = globalThis.fetch;
let calls;

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(status, bodyObj, { text } = {}) {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const body = text != null ? text : JSON.stringify(bodyObj);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    };
  };
}

test('googleLoginUrl encodes the redirect_uri against the configured base', () => {
  const u = oauthGateway.googleLoginUrl('http://localhost:4000/api/auth/google/callback');
  assert.equal(
    u,
    'https://gw.example/auth/google/login?redirect_uri=http%3A%2F%2Flocalhost%3A4000%2Fapi%2Fauth%2Fgoogle%2Fcallback'
  );
});

test('register POSTs JSON to /user/register and returns the body', async () => {
  stub(200, { success: true, message: 'Verification code sent to your email' });
  const out = await oauthGateway.register({ name: 'A', email: 'a@b.c', password: 'secret1' });
  assert.equal(out.success, true);
  assert.equal(calls[0].url, 'https://gw.example/user/register');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { name: 'A', email: 'a@b.c', password: 'secret1' });
});

test('userinfo sends the bearer token', async () => {
  stub(200, { user: { email: 'a@b.c', name: 'A', provider: 'google' } });
  const out = await oauthGateway.userinfo('tok-123');
  assert.equal(out.user.email, 'a@b.c');
  assert.equal(calls[0].url, 'https://gw.example/auth/userinfo');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer tok-123');
});

test('changePassword attaches the bearer token and body', async () => {
  stub(200, { success: true });
  await oauthGateway.changePassword({ currentPassword: 'a', newPassword: 'bbbbbb' }, 'utok');
  assert.equal(calls[0].url, 'https://gw.example/user/change-password');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer utok');
});

test('a non-2xx response throws an Error carrying status and the gateway message', async () => {
  stub(400, { error: 'Invalid email or password', code: 'VALIDATION_ERROR' });
  await assert.rejects(
    () => oauthGateway.login({ email: 'x', password: 'y' }),
    (e) => {
      assert.equal(e.message, 'Invalid email or password');
      assert.equal(e.status, 400);
      assert.equal(e.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('a plain-text error body (e.g. "Unauthorized") still surfaces as the message', async () => {
  stub(401, null, { text: 'Unauthorized' });
  await assert.rejects(
    () => oauthGateway.userinfo('bad'),
    (e) => e.message === 'Unauthorized' && e.status === 401
  );
});
