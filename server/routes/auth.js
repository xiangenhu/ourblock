/**
 * routes/auth.js — authentication, delegated to the OAuth/SMTP gateway.
 *
 *   Google sign-in        GET  /api/auth/google/start  → gateway → Google → /google/callback
 *   Email + password      POST /register → (SMTP code) → /verify → session
 *   Login                 POST /login    (local-fallback accounts first, then gateway)
 *   Account management    /resend-code, /forgot-password, /reset-password, /change-password
 *
 * The gateway owns credentials and email delivery. We keep a local user *profile*
 * in the GCS store (so posts/reactions/stats can reference a stable id), upserted on
 * every successful gateway auth. Local-fallback accounts (gateway disabled) log in
 * locally via bcrypt.
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sign, setAuthCookie, clearAuthCookie, requireAuth } from '../auth.js';
import { users } from '../store/repo.js';
import store from '../store/gcs.js';
import events from '../xapi/events.js';
import oauthGateway from '../oauthGateway.js';
import config from '../config.js';

const router = express.Router();

/** Public user shape (never leaks passwordHash or gatewayToken). */
function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    nameCjk: u.nameCjk,
    email: u.email,
    neighborhood: u.neighborhood,
    lat: u.lat,
    lng: u.lng,
    level: u.level,
    levelTitle: u.levelTitle,
    avatar: u.avatar,
    provider: u.provider || 'email',
    picture: u.picture || null,
  };
}

/**
 * Does this gateway error mean "that email already has an account"?
 * The shared gateway isn't strict about its error shape, so we match defensively:
 * a 409, a conflict-ish `code`, or an "already / exists / in use" message.
 */
function isAlreadyRegistered(e) {
  if (e.status === 409) return true;
  if (e.code && /exist|registered|duplicate|conflict|taken/i.test(e.code)) return true;
  return /already|exist|registered|in use|taken/i.test(e.message || '');
}

/** Forward a gateway error with a sensible status (4xx pass through, else 502). */
function gatewayError(res, e) {
  const status = e.status >= 400 && e.status < 500 ? e.status : e.status === 504 ? 504 : 502;
  return res.status(status).json({ error: e.message || 'Sign-in service error.' });
}

/** Find-or-create the local profile for a gateway-authenticated identity. */
async function upsertUser({ email, name, nameCjk, picture, provider, gatewayToken }) {
  const lower = String(email).trim().toLowerCase();
  let user = await users.findByEmail(lower);
  if (!user) {
    user = await users.create({
      name: name || lower.split('@')[0],
      nameCjk: nameCjk || null,
      email: lower,
      // Credentials live in the gateway; store an unusable local hash so the
      // NOT-NULL column is satisfied and local login can never match.
      passwordHash: bcrypt.hashSync(crypto.randomUUID(), 8),
      avatar: (nameCjk || name || lower).trim().charAt(0).toUpperCase() || '·',
    });
  }
  // Attach / refresh provider metadata (fields not handled by users.create()).
  const updated = await store.mutate(`db/users/${user.id}.json`, null, (doc) => {
    if (!doc) return null;
    doc.provider = provider || doc.provider || 'email';
    if (picture) doc.picture = picture;
    if (gatewayToken) doc.gatewayToken = gatewayToken;
    if (name && !doc.name) doc.name = name;
    return doc;
  });
  return updated || user;
}

/** Issue our own session cookie for a (just-authenticated) user and log it. */
function startSession(res, user) {
  const token = sign(user);
  setAuthCookie(res, token);
  events.loggedIn(user);
  return token;
}

/* ───────────────────────────── client config ──────────────────────────── */
// Lets the SPA know auth flows + which map provider to use. `country` is a best-effort
// hint from edge/CDN geo headers (empty in dev); the client also probes Google directly.
router.get('/config', (req, res) => {
  const country = (
    req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] ||
    req.headers['x-appengine-country'] || req.headers['x-country-code'] || ''
  ).toString().toUpperCase();
  res.json({
    googleEnabled: oauthGateway.enabled,
    gatewayEnabled: oauthGateway.enabled,
    gatewayUrl: oauthGateway.url,
    // Maps: provider selection happens client-side (browser location + this hint).
    mapProvider: config.maps.provider,   // auto | google | amap | leaflet
    mapsApiKey: config.maps.apiKey,       // Google JS key (referrer-restricted, public)
    amapKey: config.maps.amapKey,         // 高德 JS key (domain-restricted, public)
    country,                              // e.g. "CN" → prefer Amap; edge geo-IP hint
  });
});

/* ───────────────────────── email + password (SMTP) ─────────────────────── */
router.post('/register', async (req, res) => {
  const { name, email, password, nameCjk, neighborhood } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });
  if (String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  // Gateway disabled → local-only fallback (dev): create + sign in immediately.
  if (!oauthGateway.enabled) {
    if (await users.findByEmail(email))
      return res.status(409).json({ error: 'That email is already registered.' });
    const user = await users.create({
      name,
      nameCjk: nameCjk || null,
      email,
      passwordHash: bcrypt.hashSync(password, 10),
      neighborhood: neighborhood || null,
      avatar: (nameCjk || name).trim().charAt(0).toUpperCase() || '·',
    });
    startSession(res, user);
    return res.json({ user: publicUser(user) });
  }

  // Gateway registration → it emails a 6-digit verification code via the SMTP proxy.
  try {
    const out = await oauthGateway.register({ name, email, password });
    res.json({ pendingVerification: true, email, message: out.message || 'Verification code sent to your email.' });
  } catch (e) {
    // The SMTP gateway already knows this email (it's shared across apps, so the
    // account may have been created — and verified — elsewhere). Don't make the
    // neighbour register again: if the password they just typed matches the
    // gateway's record, log them straight in and auto-create the local profile.
    if (isAlreadyRegistered(e)) {
      try {
        const out = await oauthGateway.login({ email, password });
        const gwUser = out.user || {};
        const user = await upsertUser({
          email: gwUser.email || email,
          name: gwUser.name || name,
          nameCjk,
          provider: 'email',
          gatewayToken: out.token,
        });
        startSession(res, user);
        return res.json({ user: publicUser(user) });
      } catch (le) {
        // Email exists but the password doesn't match (or it's still unverified):
        // send them to sign-in / reset rather than silently failing.
        if (le.status === 400 || le.status === 401)
          return res.status(409).json({ error: 'That email is already registered. Try signing in instead.' });
        return gatewayError(res, le);
      }
    }
    gatewayError(res, e);
  }
});

router.post('/verify', async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required.' });
  try {
    const out = await oauthGateway.verify({ email, code });
    const gwUser = out.user || {};
    const user = await upsertUser({
      email: gwUser.email || email,
      name: gwUser.name,
      provider: 'email',
      gatewayToken: out.token,
    });
    startSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (e) {
    gatewayError(res, e);
  }
});

router.post('/resend-code', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const out = await oauthGateway.resend({ email });
    res.json({ ok: true, message: out.message || 'A new code is on its way.' });
  } catch (e) {
    gatewayError(res, e);
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  // 1) Local credentials first (any local-fallback users created while gateway off).
  const local = await users.findByEmail(email);
  if (local && local.passwordHash && bcrypt.compareSync(password, local.passwordHash)) {
    startSession(res, local);
    return res.json({ user: publicUser(local) });
  }

  // 2) Otherwise authenticate through the gateway.
  if (!oauthGateway.enabled)
    return res.status(401).json({ error: 'Wrong email or password.' });
  try {
    const out = await oauthGateway.login({ email, password });
    const gwUser = out.user || {};
    const user = await upsertUser({
      email: gwUser.email || email,
      name: gwUser.name,
      provider: 'email',
      gatewayToken: out.token,
    });
    startSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (e) {
    // The gateway rejects bad credentials with 400/401 — normalise both to a 401.
    if (e.status === 400 || e.status === 401)
      return res.status(401).json({ error: 'Wrong email or password.' });
    gatewayError(res, e);
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const out = await oauthGateway.forgot({ email });
    res.json({ ok: true, message: out.message || 'If that email exists, a reset code is on its way.' });
  } catch (e) {
    gatewayError(res, e);
  }
});

router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword)
    return res.status(400).json({ error: 'Email, code and a new password are required.' });
  if (String(newPassword).length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  try {
    // Exchange the emailed code for a reset token, then set the new password.
    const verified = await oauthGateway.verify({ email, code });
    const resetToken = verified.resetToken || verified.token;
    if (!resetToken) return res.status(400).json({ error: 'That code could not be verified.' });
    await oauthGateway.reset({ resetToken, newPassword });
    res.json({ ok: true, message: 'Password updated. You can sign in now.' });
  } catch (e) {
    gatewayError(res, e);
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Current and new password are required.' });
  if (String(newPassword).length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });

  const user = await users.getById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.provider === 'google')
    return res.status(400).json({ error: 'You sign in with Google — manage your password there.' });
  if (!user.gatewayToken)
    return res.status(400).json({ error: 'Re-sign in, then change your password.' });

  try {
    await oauthGateway.changePassword({ currentPassword, newPassword }, user.gatewayToken);
    res.json({ ok: true, message: 'Password changed.' });
  } catch (e) {
    if (e.status === 401)
      return res.status(401).json({ error: 'Your session expired — please sign in again.' });
    gatewayError(res, e);
  }
});

/* ──────────────────────────── Google OAuth ─────────────────────────────── */
const CALLBACK_PATH = '/api/auth/google/callback';

/**
 * The gateway needs an absolute redirect_uri (it bounces the browser back cross-origin,
 * so a bare relative path would resolve against the gateway's own domain). We build it
 * from the *browser's* origin rather than a hardcoded host:
 *   1. PUBLIC_URL env, if explicitly set (production override);
 *   2. the origin the SPA sent (location.origin) — but only when its host matches this
 *      request's host, so it can never be turned into an open redirect;
 *   3. otherwise reconstruct from the request (honouring proxy forwarding headers).
 * In every case the callback path is fixed server-side.
 */
function codespacesOrigin() {
  // In a GitHub Codespace the app is reached via the forwarded HTTPS URL
  //   https://<CODESPACE_NAME>-<PORT>.<FORWARDING_DOMAIN>
  // but the server internally sees Host: localhost:<PORT>, so we derive the public
  // origin from the environment instead of the (internal) request host.
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (!name || !domain) return null;
  const port = process.env.PORT || '3000';
  return `https://${name}-${port}.${domain}`;
}

function callbackUrl(req) {
  if (process.env.PUBLIC_URL) return `${process.env.PUBLIC_URL.replace(/\/+$/, '')}${CALLBACK_PATH}`;

  const cs = codespacesOrigin();
  if (cs) return `${cs}${CALLBACK_PATH}`;

  const reqHost = req.headers['x-forwarded-host'] || req.get('host');
  const supplied = req.query.origin;
  if (supplied) {
    try {
      const u = new URL(supplied);
      if (u.host === reqHost) return `${u.origin}${CALLBACK_PATH}`; // browser-correct scheme + host
    } catch { /* ignore malformed origin */ }
  }
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  return `${proto}://${reqHost}${CALLBACK_PATH}`;
}

router.get('/google/start', (req, res) => {
  if (!oauthGateway.enabled) return res.redirect('/#/login?error=oauth_disabled');
  res.redirect(oauthGateway.googleLoginUrl(callbackUrl(req)));
});

router.get('/google/callback', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/#/login?error=oauth');
  try {
    const info = await oauthGateway.userinfo(token);
    const gwUser = info.user || info;
    if (!gwUser?.email) return res.redirect('/#/login?error=oauth');
    const user = await upsertUser({
      email: gwUser.email,
      name: gwUser.name,
      picture: gwUser.picture,
      provider: 'google',
      gatewayToken: token,
    });
    startSession(res, user);
    res.redirect('/#/near');
  } catch {
    res.redirect('/#/login?error=oauth');
  }
});

/* ─────────────────────────── session / profile ────────────────────────── */
router.post('/logout', async (req, res) => {
  if (req.userId) {
    const user = await users.getById(req.userId);
    if (user) events.loggedOut(user);
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.userId) return res.json({ user: null });
  const user = await users.getById(req.userId);
  res.json({ user: user ? publicUser(user) : null });
});

router.put('/me/location', requireAuth, async (req, res) => {
  const { lat, lng, neighborhood } = req.body || {};
  const updated = await store.mutate(`db/users/${req.userId}.json`, null, (u) => {
    if (!u) return null;
    if (lat != null) u.lat = lat;
    if (lng != null) u.lng = lng;
    if (neighborhood != null) u.neighborhood = neighborhood;
    return u;
  });
  if (!updated) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(updated) });
});

export default router;
