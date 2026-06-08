/**
 * help/grounding.js — loads the contextual-help grounding doc (the product "why").
 *
 * Order of precedence (cached in-process for the lifetime of the server, per the spec —
 * the grounding markdown is stable and re-read on every uncached ask would be wasteful):
 *   1. GCS object `config/help/grounding.md`  — lets an admin edit grounding WITHOUT a redeploy.
 *   2. Bundled `server/help/grounding.md`      — always present, ships with the image.
 *
 * GCS is the persistence invariant; the bundled copy is a resilient fallback, not a second
 * store. Returns `{ markdown }` (possibly '' if neither is available → pure UI help).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import store from '../store/gcs.js';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED = path.join(__dirname, 'grounding.md');
const GCS_KEY = 'config/help/grounding.md';

let _cache = null;

export async function loadGroundingDoc() {
  if (_cache != null) return { markdown: _cache };
  let md = '';
  if (config.has.gcs()) {
    try {
      const buf = await store.getBuffer(GCS_KEY);
      if (buf && buf.length) md = buf.toString('utf8');
    } catch {
      /* fall through to the bundled copy */
    }
  }
  if (!md) {
    try { md = fs.readFileSync(BUNDLED, 'utf8'); } catch { md = ''; }
  }
  _cache = md || '';
  return { markdown: _cache };
}

/** Test/ops hook: drop the in-memory copy so the next load re-reads GCS. */
export function _resetGroundingCache() { _cache = null; }

export default { loadGroundingDoc };
