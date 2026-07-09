/**
 * helpStore.js — GCS-backed persistence for the contextual help cache + analytics.
 *
 * Per storage-invariants: GCS is the only persistence (no filesystem ref impl, no
 * localStorage for data). Layout:
 *   cache/help:{hash}.json   — first-turn answer cache + frequency analytics doc
 *
 * The frequency counters (askCount/hitCount) are mutated concurrently by many users
 * asking about the same UI element, so writes use CAS (`ifGenerationMatch`) with
 * bounded retries — no count is lost to a read-modify-write race.
 *
 * All methods no-op gracefully (return null / []) when GCS is unconfigured, so the
 * help feature degrades to "answer, don't persist" rather than 500-ing.
 */

const storage = require('./storage');

const CAS_ATTEMPTS = 5;

function bucket() {
  return storage.getBucket();
}

/** Read + parse a JSON object at `key`. Returns null if missing/unconfigured. */
async function get(key) {
  const b = bucket();
  if (!b) return null;
  try {
    const [buf] = await b.file(key).download();
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    if (e && (e.code === 404 || e.code === '404')) return null;
    throw e;
  }
}

/** Read raw bytes at `key`. Returns null if missing/unconfigured. */
async function getBuffer(key) {
  const b = bucket();
  if (!b) return null;
  try {
    const [buf] = await b.file(key).download();
    return buf;
  } catch (e) {
    if (e && (e.code === 404 || e.code === '404')) return null;
    throw e;
  }
}

/** Write raw bytes at `key`. */
async function putBuffer(key, buf, contentType = 'application/octet-stream') {
  const b = bucket();
  if (!b) return false;
  await b.file(key).save(buf, { contentType, resumable: false });
  return true;
}

/**
 * CAS-safe read-modify-write.
 *   1. read current doc + its GCS generation (0 if absent)
 *   2. next = transform(current ?? initial)
 *   3. write with ifGenerationMatch=generation; on 412 (lost race) re-read and retry
 * Returns the written doc, or null if GCS is unconfigured.
 */
async function mutate(key, initial, transform) {
  const b = bucket();
  if (!b) return null;
  const file = b.file(key);

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    let current = null;
    let generation = 0; // 0 == "object must not exist yet"
    try {
      const [meta] = await file.getMetadata();
      generation = Number(meta.generation) || 0;
      const [buf] = await file.download();
      current = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      if (e && (e.code === 404 || e.code === '404')) {
        current = null;
        generation = 0;
      } else {
        throw e;
      }
    }

    const next = transform(current == null ? initial : current);
    try {
      await file.save(Buffer.from(JSON.stringify(next)), {
        contentType: 'application/json; charset=utf-8',
        resumable: false,
        preconditions: { ifGenerationMatch: generation },
      });
      return next;
    } catch (e) {
      // 412 Precondition Failed => someone else wrote between our read and write.
      if (e && (e.code === 412 || e.code === '412')) continue;
      throw e;
    }
  }
  throw new Error(`helpStore.mutate: exhausted CAS retries for ${key}`);
}

/**
 * List JSON docs whose object name starts with `prefix`.
 * Returns [{ key, doc }]. Bad/non-JSON objects are skipped.
 */
async function listByPrefix(prefix, { limit = 500 } = {}) {
  const b = bucket();
  if (!b) return [];
  const [files] = await b.getFiles({ prefix, maxResults: limit });
  const out = [];
  for (const f of files) {
    if (out.length >= limit) break;
    try {
      const [buf] = await f.download();
      out.push({ key: f.name, doc: JSON.parse(buf.toString('utf8')) });
    } catch (_) { /* skip unreadable / non-JSON */ }
  }
  return out;
}

function isConfigured() {
  return storage.isConfigured();
}

module.exports = { get, getBuffer, putBuffer, mutate, listByPrefix, isConfigured };
