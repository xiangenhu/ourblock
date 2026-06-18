// avatar.js — deterministic generative "cartoon" avatars (③).
//
// The doc asks for an AI-generated cartoon character per user. Rather than depend on an external
// image-generation service (cost, latency, moderation), we synthesize a friendly cartoon face as
// an inline SVG from a numeric seed. Same seed → same face, everywhere, with zero network. The
// seed is stored on the user (`avatarSeed`); a fresh random seed = a brand-new character.

const SKIN = ['#F7C9A0', '#E8B07E', '#C68642', '#8D5524', '#FFE0BD', '#F1C27D'];
const HAIR = ['#2B1B12', '#4A2C18', '#7A4B28', '#B5651D', '#D9A441', '#9AA0A6', '#3B3B7A', '#7A2E5E'];
const BG = ['#E7F0EA', '#FBE7D6', '#E3E9F7', '#F6E2EE', '#E9F3F6', '#F3EEDD'];
const FACE = ['#3a2a10', '#23303a'];

// Tiny deterministic hash → 32-bit unsigned int.
function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Mulberry32 PRNG so one seed yields a stable stream of choices.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

/** Build an inline SVG cartoon avatar string for a seed. `size` is the px square. */
export function avatarSvg(seed, size = 76) {
  const r = rng(typeof seed === 'number' ? seed : seedFrom(seed || 'block'));
  const bg = pick(r, BG), skin = pick(r, SKIN), hair = pick(r, HAIR), ink = pick(r, FACE);
  const hairStyle = Math.floor(r() * 4);   // 0 short, 1 bob, 2 bun, 3 bald-ish
  const accessory = r() < 0.35;            // glasses
  const blush = r() < 0.5;
  const smile = 1 + Math.floor(r() * 3);   // mouth variant
  const browY = 30 + Math.floor(r() * 3);

  const hairTop = {
    0: `<path d="M22 34 Q24 14 50 14 Q76 14 78 34 Q78 24 50 22 Q22 24 22 34Z" fill="${hair}"/>`,
    1: `<path d="M18 40 Q16 12 50 12 Q84 12 82 40 L74 40 Q78 22 50 22 Q22 22 26 40Z" fill="${hair}"/>`,
    2: `<circle cx="50" cy="14" r="8" fill="${hair}"/><path d="M24 32 Q26 16 50 16 Q74 16 76 32 Q74 24 50 24 Q26 24 24 32Z" fill="${hair}"/>`,
    3: `<path d="M28 30 Q34 20 50 20 Q66 20 72 30 Q66 26 50 26 Q34 26 28 30Z" fill="${hair}"/>`,
  }[hairStyle];

  const mouth = {
    1: `<path d="M42 64 Q50 70 58 64" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    2: `<path d="M43 63 Q50 72 57 63 Q50 67 43 63Z" fill="${ink}"/>`,
    3: `<circle cx="50" cy="65" r="3.4" fill="${ink}"/>`,
  }[smile];

  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="avatar">
    <rect width="100" height="100" rx="22" fill="${bg}"/>
    <ellipse cx="50" cy="86" rx="30" ry="16" fill="${skin}" opacity=".45"/>
    <circle cx="50" cy="48" r="26" fill="${skin}"/>
    ${blush ? `<circle cx="34" cy="56" r="5" fill="#E8836B" opacity=".35"/><circle cx="66" cy="56" r="5" fill="#E8836B" opacity=".35"/>` : ''}
    <circle cx="41" cy="48" r="3.1" fill="${ink}"/><circle cx="59" cy="48" r="3.1" fill="${ink}"/>
    <path d="M36 ${browY} Q41 ${browY - 3} 46 ${browY}" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M54 ${browY} Q59 ${browY - 3} 64 ${browY}" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${accessory ? `<g stroke="${ink}" stroke-width="2" fill="none"><circle cx="41" cy="48" r="6"/><circle cx="59" cy="48" r="6"/><path d="M47 48 H53"/></g>` : ''}
    ${mouth}
    ${hairTop}
  </svg>`;
}

/** A random 32-bit seed for "regenerate". */
export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
