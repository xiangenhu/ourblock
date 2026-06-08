import jwt from 'jsonwebtoken';

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
