/**
 * health.js — liveness + integration health.
 *
 *   GET /api/health           cheap: app up + which integrations are CONFIGURED
 *   GET /api/health?deep=1     also PINGS gcs / llm / lrs and reports per-service status
 *
 * Deep checks are real round-trips (a GCS metadata read, a tiny LLM call, an LRS /about),
 * so they cost money/latency — keep them out of the cheap path used by load balancers.
 */
import express from 'express';
import config from '../config.js';
import store from '../store/gcs.js';
import { callLLM } from '../llm/gateway.js';
import xapi from '../xapi/client.js';

const router = express.Router();

async function timed(fn) {
  const start = process.hrtime.bigint();
  try {
    const detail = await fn();
    return { ok: true, ms: Number(process.hrtime.bigint() - start) / 1e6, detail };
  } catch (e) {
    return { ok: false, ms: Number(process.hrtime.bigint() - start) / 1e6, error: e.message };
  }
}

async function pingGcs() {
  // A namespaced probe write+read+delete proves read_write without touching app data.
  const key = 'health/_probe.json';
  await store.set(key, { t: Date.now() });
  const back = await store.get(key);
  await store.del(key);
  return { bucket: config.gcs.bucket, roundTrip: !!back };
}

async function pingLlm() {
  const txt = await callLLM({ feature: 'health', maxTokens: 5, user: 'Reply with the single word: ok' });
  return { vendor: config.llm.vendor, model: config.requireLlm().model, sample: String(txt).slice(0, 40) };
}

async function pingLrs() {
  const c = config.requireLrs();
  const r = await fetch(`${c.endpoint}/about`, { headers: { 'X-Experience-API-Version': c.version } });
  if (!r.ok) throw new Error(`/about ${r.status}`);
  const about = await r.json().catch(() => ({}));
  return { endpoint: c.endpoint, versions: about.version };
}

router.get('/', async (req, res) => {
  const configured = { gcs: config.has.gcs(), llm: config.has.llm(), lrs: config.has.lrs() };
  if (req.query.deep == null) {
    return res.json({ ok: true, app: 'Our Block', configured });
  }

  const services = {};
  await Promise.all([
    config.has.gcs() ? timed(pingGcs).then((r) => (services.gcs = r)) : (services.gcs = { ok: false, error: 'not configured' }),
    config.has.llm() ? timed(pingLlm).then((r) => (services.llm = r)) : (services.llm = { ok: false, error: 'not configured' }),
    config.has.lrs() ? timed(pingLrs).then((r) => (services.lrs = r)) : (services.lrs = { ok: false, error: 'not configured' }),
  ]);

  const ok = Object.values(services).every((s) => s.ok);
  res.status(ok ? 200 : 503).json({ ok, app: 'Our Block', configured, services });
});

export default router;
