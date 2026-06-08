/**
 * store/gcs.js — the ONE persistence layer (project invariant: GCS-only).
 *
 * JSON docs:
 *   get(key)                         -> doc | null
 *   set(key, doc)                    -> doc                 (overwrite)
 *   mutate(key, initial, transform)  -> doc                 (CAS read-modify-write)
 *   del(key)                         -> boolean
 *   listByPrefix(prefix, {limit})    -> [{ key, doc }]
 *
 * Raw bytes (media):
 *   putBuffer(key, buf, contentType) -> { key, size, contentType }
 *   getStream(key)                   -> { stream, contentType, size } | null
 *   getBuffer(key)                   -> Buffer | null
 *
 * CAS uses GCS object *generation* preconditions (ifGenerationMatch): 0 = create-if-absent,
 * N = overwrite-only-if-unchanged. There is no localStorage / local-disk fallback — that is
 * the point. On Cloud Run, auth is ADC (no keyFile); locally it is the service-account key.
 *
 * All keys are namespaced under config.gcs.prefix so one bucket can host many apps.
 */
import { Storage } from '@google-cloud/storage';
import config from '../config.js';

let _bucket = null;
function bucket() {
  if (_bucket) return _bucket;
  const gcs = config.requireGcs();
  const opts = {};
  if (gcs.projectId) opts.projectId = gcs.projectId;
  if (gcs.keyFile) opts.keyFilename = gcs.keyFile; // local dev only; Cloud Run uses ADC
  _bucket = new Storage(opts).bucket(gcs.bucket);
  return _bucket;
}

/** Prefix a logical key with the configured app prefix (e.g. "db/posts/1.json"). */
function full(key) {
  const p = config.gcs.prefix;
  const clean = String(key).replace(/^\/+/, '');
  return p ? `${p}/${clean}` : clean;
}
/** Strip the app prefix back off a GCS object name for callers. */
function strip(name) {
  const p = config.gcs.prefix;
  return p && name.startsWith(p + '/') ? name.slice(p.length + 1) : name;
}

const CAS_RETRIES = 5;
const is404 = (e) => e && (e.code === 404 || e.code === '404');

async function readWithGeneration(key) {
  const file = bucket().file(full(key));
  try {
    const [buf] = await file.download();
    const [meta] = await file.getMetadata();
    return { doc: JSON.parse(buf.toString('utf8')), generation: meta.generation };
  } catch (e) {
    if (is404(e)) return { doc: null, generation: 0 };
    throw e;
  }
}

export async function get(key) {
  return (await readWithGeneration(key)).doc;
}

export async function set(key, doc) {
  await bucket().file(full(key)).save(Buffer.from(JSON.stringify(doc)), {
    contentType: 'application/json; charset=utf-8',
    resumable: false,
  });
  return doc;
}

export async function mutate(key, initial, transform) {
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    const { doc, generation } = await readWithGeneration(key);
    const next = await transform(doc == null ? initial : doc);
    try {
      await bucket().file(full(key)).save(Buffer.from(JSON.stringify(next)), {
        contentType: 'application/json; charset=utf-8',
        resumable: false,
        preconditionOpts: { ifGenerationMatch: Number(generation) }, // 0 = create-if-absent
      });
      return next;
    } catch (e) {
      if (e && (e.code === 412 || e.code === '412')) continue; // generation moved; re-read & retry
      throw e;
    }
  }
  throw new Error(`[gcs] mutate failed after ${CAS_RETRIES} attempts (contention) for ${key}`);
}

export async function del(key) {
  try {
    await bucket().file(full(key)).delete();
    return true;
  } catch (e) {
    if (is404(e)) return false;
    throw e;
  }
}

/** Delete every object under a logical prefix (used by seed --reset). Returns count. */
export async function clearPrefix(prefix) {
  const [files] = await bucket().getFiles({ prefix: full(prefix) });
  await Promise.all(files.map((f) => f.delete().catch(() => {})));
  return files.length;
}

export async function listByPrefix(prefix, { limit = 1000 } = {}) {
  const [files] = await bucket().getFiles({ prefix: full(prefix), maxResults: limit });
  const out = [];
  for (const f of files) {
    if (!f.name.endsWith('.json')) continue;
    try {
      const [buf] = await f.download();
      out.push({ key: strip(f.name).replace(/\.json$/, ''), doc: JSON.parse(buf.toString('utf8')) });
    } catch {
      /* skip unreadable */
    }
    if (out.length >= limit) break;
  }
  return out;
}

// ── Raw bytes (media) ────────────────────────────────────────────────────────
export async function putBuffer(key, buf, contentType = 'application/octet-stream') {
  await bucket().file(full(key)).save(buf, { contentType, resumable: false });
  return { key, size: buf.length, contentType };
}

export async function getBuffer(key) {
  try {
    const [buf] = await bucket().file(full(key)).download();
    return buf;
  } catch (e) {
    if (is404(e)) return null;
    throw e;
  }
}

/** Stream bytes back to a client without buffering the whole object in memory. */
export async function getStream(key) {
  const file = bucket().file(full(key));
  try {
    const [meta] = await file.getMetadata();
    return {
      stream: file.createReadStream(),
      contentType: meta.contentType || 'application/octet-stream',
      size: Number(meta.size) || undefined,
    };
  } catch (e) {
    if (is404(e)) return null;
    throw e;
  }
}

export default { get, set, mutate, del, clearPrefix, listByPrefix, putBuffer, getBuffer, getStream };
