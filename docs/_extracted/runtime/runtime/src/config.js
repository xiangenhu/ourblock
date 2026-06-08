'use strict';
/**
 * config.js — single source of truth for environment configuration.
 * Every runtime module reads config from here, never from process.env directly.
 * Required vars fail loud at startup (the project invariant: "startup fails loudly
 * when required vars are missing"). Optional features no-op when their vars are absent.
 */
try { require('dotenv').config(); } catch (_) { /* dotenv optional; app may load env itself */ }

function req(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`[config] required env var missing: ${name}`);
  }
  return v;
}
function opt(name, dflt) {
  const v = process.env[name];
  return (v === undefined || v === '') ? dflt : v;
}
function bool(name, dflt) {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}
function int(name, dflt) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : dflt;
}

// `validate()` is called by index.js at mount time so missing REQUIRED vars
// surface immediately rather than on first request.
function buildConfig() {
  return {
    appSlug: opt('APP_SLUG', 'app'),
    appUrl: opt('APP_URL', 'http://localhost:3000'),
    nodeEnv: opt('NODE_ENV', 'development'),
    port: int('PORT', 3000),

    gcs: {
      projectId: opt('GCP_PROJECT_ID', null),
      bucket: opt('GCS_BUCKET_NAME', null),     // REQUIRED for persistence; checked in store/gcs
      keyFile: opt('GCS_KEY_FILE', null),       // local dev only; Cloud Run uses ADC
    },

    // Unified LLM gateway (help, content). Provider-agnostic via an OpenAI-compatible endpoint.
    llm: {
      endpoint: opt('LLM_GATEWAY_ENDPOINT', 'https://api.openai.com/v1/chat/completions'),
      apiKey: opt('LLM_GATEWAY_API_KEY', process.env.OPENAI_API_KEY || null),
      model: opt('LLM_MODEL', 'gpt-4o-mini'),
      maxTokens: int('LLM_MAX_TOKENS', 400),
      // Cost estimation prices in USD per 1M tokens: { model: { in, out } }. PRICES CHANGE —
      // override via env LLM_PRICES (JSON). '*' is a fallback for unlisted models.
      prices: (() => {
        try { return JSON.parse(opt('LLM_PRICES', '')); } catch (_) { /* fall through to defaults */ }
        return { 'gpt-4o-mini': { in: 0.15, out: 0.60 }, 'gpt-4o': { in: 2.5, out: 10 }, '*': { in: 0.5, out: 1.5 } };
      })(),
      cache: {
        backend: opt('LLM_CACHE_BACKEND', 'gcs'),         // 'gcs' (recommended) | 'lrs' | 'off'
        defaultOn: bool('LLM_CACHE_DEFAULT', false),       // cache unless a call opts out
        max: int('CACHE_MAX', 3),                          // max variants kept per unique request
        ttlMs: int('LLM_CACHE_TTL_DAYS', 7) * 864e5,
        // Dedicated cache LRS — MUST NOT be the learning LRS (keeps non-learning data out of it).
        lrs: {
          endpoint: opt('LLM_CACHE_LRS_ENDPOINT', null),
          username: opt('LLM_CACHE_LRS_USERNAME', null),
          password: opt('LLM_CACHE_LRS_PASSWORD', null),
        },
      },
    },

    // Learning Record Store (team-xapi) — distinct from the bug LRS below.
    lrs: {
      endpoint: opt('LRS_ENDPOINT', null),
      username: opt('LRS_USERNAME', null),
      password: opt('LRS_PASSWORD', null),
    },

    // Bug telemetry LRS (team-bugfix) — intentionally separate from the learning LRS.
    bugLrs: {
      endpoint: opt('BUG_LRS_ENDPOINT', null),
      username: opt('BUG_LRS_USERNAME', null),
      password: opt('BUG_LRS_PASSWORD', null),
      appId: opt('BUG_APP_ID', 'default'),
    },

    help: {
      dwellMs: int('HELP_HOVER_DWELL_MS', 3000),
      groundingDocPath: opt('HELP_GROUNDING_GCS_PATH', null), // GCS object path, optional
    },

    tts: {
      enabled: !!opt('OPENAI_API_KEY', null),
      apiKey: opt('OPENAI_API_KEY', null),
      model: opt('TTS_MODEL', 'gpt-4o-mini-tts'),
      voice: opt('TTS_VOICE', 'alloy'),
    },

    // Cookie name carrying the UI language (hash-based i18n).
    langCookie: opt('LANG_COOKIE', 'lang'),
  };
}

let _cfg = null;
function config() { return (_cfg || (_cfg = buildConfig())); }

// REQUIRED-var groups, checked lazily by the modules that need them.
config.requireGcs = function () {
  const c = config();
  if (!c.gcs.bucket) throw new Error('[config] GCS_BUCKET_NAME is required for persistence (project invariant: GCS-only storage)');
  return c.gcs;
};
config.requireLlm = function () {
  const c = config();
  if (!c.llm.apiKey) throw new Error('[config] LLM_GATEWAY_API_KEY (or OPENAI_API_KEY) is required for the LLM gateway');
  return c.llm;
};
config.helpers = { req, opt, bool, int };
module.exports = config;
