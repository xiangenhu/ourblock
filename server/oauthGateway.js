/**
 * oauthGateway.js — client for the OAuth2 & SMTP Proxy Gateway
 * (https://oauth.xiangenhu.info, see /instruction).
 *
 * The gateway owns two things Our Block delegates to it:
 *   1. Google sign-in  — /auth/google/login → Google → callback with ?token=,
 *      then /auth/userinfo returns the verified profile.
 *   2. Email/password accounts with SMTP-delivered verification & reset codes —
 *      /user/register, /user/verify, /user/login, /user/forgot-password, etc.
 *
 * Configuration (env):
 *   OAUTH_GATEWAY_URL   base URL          (default https://oauth.xiangenhu.info)
 *   OAUTH_ENABLED       on/off            (default on)
 *   PUBLIC_URL          this app's public origin, used to build the OAuth
 *                       redirect_uri      (default: derived from the request)
 */

const GATEWAY = (process.env.OAUTH_GATEWAY_URL || 'https://oauth.xiangenhu.info').replace(/\/+$/, '');
const ENABLED = !/^(0|false|no|off)$/i.test(process.env.OAUTH_ENABLED ?? 'on');

async function call(method, path, { body, token, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(GATEWAY + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      const err = new Error(data.error || data.message || text || `Gateway error ${res.status}`);
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('The sign-in service did not respond. Please try again.');
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const oauthGateway = {
  url: GATEWAY,
  enabled: ENABLED,

  // ── email / password accounts (SMTP-backed) ──────────────────────────────
  register: (b) => call('POST', '/user/register', { body: b }),
  verify: (b) => call('POST', '/user/verify', { body: b }),
  resend: (b) => call('POST', '/user/resend-code', { body: b }),
  login: (b) => call('POST', '/user/login', { body: b }),
  forgot: (b) => call('POST', '/user/forgot-password', { body: b }),
  reset: (b) => call('POST', '/user/reset-password', { body: b }),
  changePassword: (b, token) => call('POST', '/user/change-password', { body: b, token }),

  // ── OAuth (Google) ───────────────────────────────────────────────────────
  userinfo: (token) => call('GET', '/auth/userinfo', { token }),
  googleLoginUrl: (redirectUri) =>
    `${GATEWAY}/auth/google/login?redirect_uri=${encodeURIComponent(redirectUri)}`,

  health: () => call('GET', '/health'),
};

export default oauthGateway;
