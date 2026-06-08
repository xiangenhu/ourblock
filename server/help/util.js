/**
 * help/util.js — privacy + abuse guards for the public help endpoints.
 *
 * The ask/tts routes are public BY DESIGN (they run on pre-sign-in pages), so they need two
 * guards the rest of the app can assume the auth cookie provides:
 *   - redactPII()   : the snippet/question/locationHint are sent to the LLM AND persisted in
 *                     analytics. Strip obvious PII (emails, phone/long-digit runs) before either.
 *                     Defense in depth — the analytics doc is already not identity-linked.
 *   - rateLimiter() : a small per-IP token bucket so an open endpoint can't be used to burn the
 *                     LLM/TTS budget. In-memory (per Cloud Run instance); good enough as a first
 *                     gate — a shared store (GCS/Redis) would be needed for strict global limits.
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// 7+ digits possibly separated by spaces/dashes/parens → phone-ish / id-ish runs.
const NUMRUN_RE = /\b(?:\+?\d[\s().-]?){7,}\d\b/g;

export function redactPII(s) {
  if (s == null) return s;
  return String(s).replace(EMAIL_RE, '[email]').replace(NUMRUN_RE, '[number]');
}

export function rateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown';
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || now > rec.reset) {
      hits.set(ip, { count: 1, reset: now + windowMs });
    } else if (rec.count >= max) {
      res.set('Retry-After', String(Math.ceil((rec.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests — slow down a moment.' });
    } else {
      rec.count += 1;
    }
    // Opportunistic cleanup so the map can't grow unbounded.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    next();
  };
}

export default { redactPII, rateLimiter };
