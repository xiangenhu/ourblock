/**
 * config.js — the one place env is read and validated.
 *
 * Three external dependencies, each with a `require*()` guard that throws a clear
 * error if used while unconfigured (so a missing var fails loudly at the call site
 * rather than as a vague 500 later):
 *   - gcs : the sole persistence layer (media + data). ADC on Cloud Run; keyfile locally.
 *   - llm : the single model gateway (multi-vendor, switched by LLM_VENDOR).
 *   - lrs : the xAPI Learning Record Store.
 */

const env = process.env;

function bool(v, dflt = false) {
  if (v == null || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

// ── GCS ──────────────────────────────────────────────────────────────────────
const gcs = {
  bucket: env.GCS_BUCKET || '',
  // All app objects live under this prefix so one bucket can be shared.
  prefix: (env.GCS_PREFIX || '').replace(/\/+$/, ''),
  projectId: env.GCS_PROJECT_ID || '',
  // Local dev points at a service-account key; on Cloud Run leave unset → ADC.
  keyFile: env.GOOGLE_APPLICATION_CREDENTIALS || '',
};

// ── LRS (xAPI) ───────────────────────────────────────────────────────────────
const lrs = {
  endpoint: (env.XAPI_LRS_ENDPOINT || '').replace(/\/+$/, ''),
  username: env.XAPI_LRS_USERNAME || '',
  password: env.XAPI_LRS_PASSWORD || '',
  version: env.XAPI_VERSION || '1.0.3',
  // Public base URL used to mint activity/actor IRIs in statements.
  appUrl: (env.APP_URL || 'https://ourblock.app').replace(/\/+$/, ''),
};

// ── LLM gateway ──────────────────────────────────────────────────────────────
// Per-vendor connection details; the gateway picks one by LLM_VENDOR.
const VENDORS = {
  openai: {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    shape: 'openai',
  },
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    baseUrl: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    model: env.ANTHROPIC_MODEL || 'claude-opus-4-8',
    shape: 'anthropic',
  },
  gemini: {
    apiKey: env.GOOGLE_AI_API_KEY,
    baseUrl: (env.GOOGLE_AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
    model: env.GOOGLE_AI_MODEL || 'gemini-1.5-flash',
    shape: 'gemini',
  },
  groq: {
    apiKey: env.GROQ_API_KEY,
    baseUrl: (env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    model: env.GROQ_MODEL || '',
    shape: 'openai', // OpenAI-compatible
  },
  deepseek: {
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: env.DEEPSEEK_MODEL || 'deepseek-chat',
    shape: 'openai',
  },
  ollama: {
    apiKey: env.CUSTOM_LLM_API_KEY || 'ollama',
    baseUrl: (env.OLLAMA_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, ''),
    model: env.OLLAMA_MODEL || '',
    shape: 'openai',
  },
};

const llm = {
  vendor: (env.LLM_VENDOR || 'openai').toLowerCase(),
  // LLM_MODEL overrides the vendor default when set.
  modelOverride: env.LLM_MODEL || '',
  timeoutMs: Number(env.LLM_TIMEOUT_MS) || 60000,
  vendors: VENDORS,
};

// ── Google Maps (browser SDK + Geocoding; one referrer-restricted public key) ─
const maps = {
  apiKey: env.MAPS_API_KEY || '',
};

// ── Misc ─────────────────────────────────────────────────────────────────────
const config = {
  port: Number(env.PORT) || 3000,
  nodeEnv: env.NODE_ENV || 'development',
  policy: env.POLICY || 'L2',
  teacherEmails: (env.TEACHER_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  gcs,
  lrs,
  llm,
  maps,
};

config.requireGcs = function requireGcs() {
  if (!gcs.bucket) throw new Error('[config] GCS_BUCKET is not set — GCS is the only persistence layer.');
  return gcs;
};

config.requireLlm = function requireLlm() {
  const v = llm.vendors[llm.vendor];
  if (!v) {
    throw new Error(`[config] LLM_VENDOR="${llm.vendor}" is unknown. Known: ${Object.keys(llm.vendors).join(', ')}.`);
  }
  if (!v.apiKey) {
    throw new Error(`[config] LLM_VENDOR="${llm.vendor}" selected but its API key is empty.`);
  }
  return { ...v, model: llm.modelOverride || v.model, timeoutMs: llm.timeoutMs };
};

config.requireLrs = function requireLrs() {
  if (!lrs.endpoint || !lrs.username || !lrs.password) {
    throw new Error('[config] XAPI_LRS_ENDPOINT / XAPI_LRS_USERNAME / XAPI_LRS_PASSWORD must be set.');
  }
  return lrs;
};

/** True when the integration is configured enough to use (lets callers degrade gracefully). */
config.has = {
  gcs: () => !!gcs.bucket,
  llm: () => !!(llm.vendors[llm.vendor] && llm.vendors[llm.vendor].apiKey),
  lrs: () => !!(lrs.endpoint && lrs.username && lrs.password),
  maps: () => !!maps.apiKey,
};

config.bool = bool;

export default config;
