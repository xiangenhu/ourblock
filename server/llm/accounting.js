/**
 * llm/accounting.js — per-user token accounting (team-cost).
 *
 * Every real LLM call is recorded to GCS, keyed per day+user: usage/{YYYY-MM-DD}/{userId}.json.
 * Token COUNTS only — never prompt content. record() must NEVER throw: accounting is not allowed
 * to break a request, so all failures are swallowed.
 */
import store from '../store/gcs.js';
import config from '../config.js';

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const keyFor = (date, userId) => `usage/${date}/${String(userId || 'anonymous')}.json`;

/** Merge one call into a per-(day,user) rollup. Pure — unit-testable. */
export function mergeEntry(doc, { feature = 'general', vendor = 'unknown', model = 'unknown', usage = {} }) {
  const base = doc || {
    userId: null, date: null, features: {},
    calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0,
  };
  const inT = usage.prompt_tokens || 0;
  const outT = usage.completion_tokens || 0;
  const tot = usage.total_tokens || inT + outT;
  base.calls += 1;
  base.promptTokens += inT;
  base.completionTokens += outT;
  base.totalTokens += tot;
  const fkey = `${feature}`;
  const f = (base.features[fkey] = base.features[fkey] || { byModel: {} });
  const mkey = `${vendor}:${model}`;
  const m = (f.byModel[mkey] = f.byModel[mkey] || { calls: 0, promptTokens: 0, completionTokens: 0 });
  m.calls += 1;
  m.promptTokens += inT;
  m.completionTokens += outT;
  return base;
}

/** Record a call. Never throws. */
export async function record({ userId, feature, vendor, model, usage } = {}) {
  if (!config.has.gcs()) return; // no store configured → skip silently
  try {
    const date = day();
    await store.mutate(
      keyFor(date, userId),
      { userId: userId || 'anonymous', date, features: {}, calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      (d) => {
        const next = mergeEntry(d, { feature, vendor, model, usage });
        next.userId = userId || 'anonymous';
        next.date = date;
        return next;
      }
    );
  } catch {
    /* accounting must not break the call */
  }
}

export default { record, mergeEntry, keyFor };
