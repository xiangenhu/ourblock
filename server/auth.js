import jwt from 'jsonwebtoken';
import config from './config.js';
import { users } from './store/repo.js';

const SECRET = process.env.JWT_SECRET || 'ourblock-dev-secret-change-me';
const MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 days

export function sign(user) {
  return jwt.sign({ id: user.id, name: user.name }, SECRET, { expiresIn: '30d' });
}

export function setAuthCookie(res, token) {
  res.cookie('ob_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAX_AGE,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie('ob_token');
}

/** Populates req.userId when a valid token is present; never rejects. */
export function attachUser(req, _res, next) {
  const token =
    req.cookies?.ob_token ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      req.userId = jwt.verify(token, SECRET).id;
    } catch {
      /* ignore invalid/expired tokens */
    }
  }
  next();
}

/** Hard gate for routes that require a logged-in user. */
export function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Sign in to do that.' });
  next();
}

/** True when an email is on the admin/steward allowlist (TEACHER_EMAILS). Role is always
 *  derived server-side from the verified user — never from a client-asserted flag. */
export function isAdminEmail(email) {
  const e = (email || '').trim().toLowerCase();
  return !!e && config.teacherEmails.includes(e);
}

/**
 * Hard gate for Admin-only routes (deny by default — see _shared/roles.md).
 *
 * Our Block's only elevated allowlist is TEACHER_EMAILS (config.teacherEmails) — the
 * steward/admin tier — so that is what "Admin" means here. Role is enforced server-side
 * on the email of the verified token's user; a client-asserted role is never trusted.
 *   401 → not signed in    403 → signed in but not on the admin allowlist
 */
export async function requireAdmin(req, res, next) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Sign in to do that.' });
    const user = await users.getById(req.userId);
    const email = (user?.email || '').trim().toLowerCase();
    if (!email || !config.teacherEmails.includes(email)) {
      return res.status(403).json({ error: 'Admins only.' });
    }
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}
