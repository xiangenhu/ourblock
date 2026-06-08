'use strict';
/**
 * store/gcs.js — the ONE persistence layer (project invariant: GCS-only).
 * Implements the persistence contract used across the skills (CONTEXT_HELP.md §11.1,
 * BUG_TRACKING_AND_FIXING.md §11.1):
 *
 *   get(key)                       -> doc | null
 *   set(key, doc)                  -> doc            (overwrite)
 *   mutate(key, initial, transform)-> doc            (CAS read-modify-write)
 *   listByPrefix(prefix, {limit})  -> [{ key, doc }]
 *   getBuffer(key) / putBuffer(key, buf, contentType)
 *
 * CAS uses GCS object *generation* preconditions (`ifGenerationMatch`), which is the
 * production-correct equivalent of the spec's `if-generation-match: 0 | N`. There is no
 * localStorage / local-disk fallback — that is the point.
 */
const config = require('../config');

let _bucket = null;
function bucket() {
  if (_bucket) return _bucket;
  const gcs = config.requireGcs();
  const { Storage } = require('@google-cloud/storage'); // lazy: only needed when persistence is used
  const opts = {};
  if (gcs.projectId) opts.projectId = gcs.projectId;
  if (gcs.keyFile) opts.keyFilename = gcs.keyFile; // local dev only; Cloud Run uses ADC
  _bucket = new Storage(opts).bucket(gcs.bucket);
  return _bucket;
}

const CAS_RETRIES = 5;

async function readWithGeneration(key) {
  const file = bucket().file(key);
  try {
    const [buf] = await file.download();
    const [meta] = await file.getMetadata();
    return { doc: JSON.parse(buf.toString('utf8')), generation: meta.generation };
  } catch (e) {
    if (e && (e.code === 404 || e.code === '404')) return { doc: null, generation: 0 };
    throw e;
  }
}

async function get(key) {
  return (await readWithGeneration(key)).doc;
}

async function set(key, doc) {
  await bucket().file(key).save(Buffer.from(JSON.stringify(doc)), {
    contentType: 'application/json; charset=utf-8',
    resumable: false,
  });
  return doc;
}

async function mutate(key, initial, transform) {
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    const { doc, generation } = await readWithGeneration(key);
    const next = transform(doc || initial);
    try {
      await bucket().file(key).save(Buffer.from(JSON.stringify(next)), {
        contentType: 'application/json; charset=utf-8',
        resumable: false,
        preconditionOpts: { ifGenerationMatch: Number(generation) }, // CAS: 0 = create-if-absent
      });
      return next;
    } catch (e) {
      if (e && (e.code === 412 || e.code === '412')) continue; // generation moved; re-read and retry
      throw e;
    }
  }
  throw new Error(`[gcs] mutate failed after ${CAS_RETRIES} attempts (contention) for ${key}`);
}

async function listByPrefix(prefix, { limit = 500 } = {}) {
  const [files] = await bucket().getFiles({ prefix, maxResults: limit });
  const out = [];
  for (const f of files) {
    if (!f.name.endsWith('.json')) continue;
    try {
      const [buf] = await f.download();
      out.push({ key: f.name.replace(/\.json$/, ''), doc: JSON.parse(buf.toString('utf8')) });
    } catch (_) { /* skip unreadable */ }
    if (out.length >= limit) break;
  }
  return out;
}

async function getBuffer(key) {
  try { const [buf] = await bucket().file(key).download(); return buf; }
  catch (e) { if (e && (e.code === 404 || e.code === '404')) return null; throw e; }
}
async function putBuffer(key, buf, contentType = 'application/octet-stream') {
  await bucket().file(key).save(buf, { contentType, resumable: false });
}

module.exports = { get, set, mutate, listByPrefix, getBuffer, putBuffer };
