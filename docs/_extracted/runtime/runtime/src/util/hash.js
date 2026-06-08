'use strict';
const crypto = require('crypto');

/** FNV-1a 32-bit → base36. Matches the client cache hash in contextual-help.js so
 *  client and server cache shapes line up (CONTEXT_HELP.md §4.5). */
function fnv1a(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

/** SHA-256, first 16 hex chars — the hash-based i18n key (team-i18n). */
function i18nHash(text) {
  return crypto.createHash('sha256').update(String(text).trim()).digest('hex').slice(0, 16);
}

/** Short SHA-1 — server help/tts cache keys (CONTEXT_HELP.md §5). */
function shortSha1(s, n = 16) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, n);
}

module.exports = { fnv1a, i18nHash, shortSha1 };
