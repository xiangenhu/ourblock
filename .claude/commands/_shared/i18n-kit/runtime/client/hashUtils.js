/**
 * Hash-based i18n Utilities
 * Generates SHA-256 hashes for text strings (first 16 characters)
 */

/**
 * Generate SHA-256 hash of text, returning first 16 characters
 * @param {string} text - English text to hash
 * @returns {Promise<string>} - First 16 chars of SHA-256 hash
 */
export async function generateHash(text) {
  const trimmed = text.trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(trimmed);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 16);
}

/**
 * Synchronous hash generation using a simple hash function
 * (For cases where async isn't practical)
 * @param {string} text - English text to hash
 * @returns {string} - First 16 chars of hash
 */
export function generateHashSync(text) {
  const trimmed = text.trim();
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  // Convert to hex and pad to ensure 16 chars
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  // Create a more unique hash by combining with length and char codes
  let extra = trimmed.length.toString(16).padStart(4, '0');
  for (let i = 0; i < Math.min(4, trimmed.length); i++) {
    extra += trimmed.charCodeAt(i).toString(16).slice(-1);
  }
  return (hex + extra).substring(0, 16);
}

/**
 * Pre-computed hash cache for performance
 */
const hashCache = new Map();

/**
 * Get or compute hash with caching
 * @param {string} text - English text
 * @returns {string} - Hash
 */
export function getHash(text) {
  const trimmed = text.trim();
  if (hashCache.has(trimmed)) {
    return hashCache.get(trimmed);
  }
  const hash = generateHashSync(trimmed);
  hashCache.set(trimmed, hash);
  return hash;
}

export default { generateHash, generateHashSync, getHash };
