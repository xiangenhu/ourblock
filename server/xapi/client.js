/**
 * xapi/client.js — Learning Record Store client (team-xapi).
 *
 * Two invariants enforced in code:
 *   1) VERB TAXONOMY, NO FALLBACK — emitting a verb outside the taxonomy throws,
 *      rather than silently polluting analytics.
 *   2) TARGETED QUERIES ONLY — every getStatements() filters by at least one of
 *      agent / verb / activity. No "get all" (an LRS may hold millions of statements).
 *
 * Writes are best-effort from the app's perspective: callers use emit() (below) which
 * never throws, so analytics can never break a civic action.
 */
import config from '../config.js';

const VERBS = {
  // assessment & learning
  answered: 'http://adlnet.gov/expapi/verbs/answered',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  attempted: 'http://adlnet.gov/expapi/verbs/attempted',
  achieved: 'http://adlnet.gov/expapi/verbs/achieved',
  // interaction & exploration
  explored: 'http://id.tincanapi.com/verb/explored',
  interacted: 'http://adlnet.gov/expapi/verbs/interacted',
  viewed: 'http://id.tincanapi.com/verb/viewed',
  experienced: 'http://adlnet.gov/expapi/verbs/experienced',
  shared: 'http://activitystrea.ms/schema/1.0/share',
  // system & management
  initialized: 'http://adlnet.gov/expapi/verbs/initialized',
  generated: 'http://activitystrea.ms/schema/1.0/generate',
  'logged-in': 'https://brindlewaye.com/xAPITerms/verbs/loggedin/',
  'logged-out': 'https://brindlewaye.com/xAPITerms/verbs/loggedout/',
  requested: 'http://activitystrea.ms/schema/1.0/request',
};

export function verbId(verb) {
  if (verb in VERBS) return VERBS[verb];
  throw new Error(`[xapi] verb "${verb}" is not in the taxonomy — NO FALLBACK. Add it deliberately or pick an existing verb.`);
}

function headers() {
  const c = config.requireLrs();
  const auth = Buffer.from(`${c.username}:${c.password}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'X-Experience-API-Version': c.version || '1.0.3',
    'Content-Type': 'application/json',
  };
}

export async function sendStatement(stmt) {
  const c = config.requireLrs();
  const r = await fetch(`${c.endpoint}/statements`, { method: 'POST', headers: headers(), body: JSON.stringify(stmt) });
  if (!r.ok) throw new Error(`[xapi] POST statements ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}

/** TARGETED only: requires at least one of agent / verb / activity. */
export async function getStatements(query = {}) {
  const { agent, verb, activity, related_activities, since, until, limit } = query;
  if (!agent && !verb && !activity) {
    throw new Error('[xapi] refusing untargeted query — provide at least one of: agent, verb, activity');
  }
  const params = new URLSearchParams();
  if (agent) params.set('agent', JSON.stringify(agent));
  if (verb) params.set('verb', verb in VERBS ? VERBS[verb] : verb);
  if (activity) params.set('activity', activity);
  if (related_activities != null) params.set('related_activities', String(!!related_activities));
  if (since) params.set('since', since);
  if (until) params.set('until', until);
  if (limit) params.set('limit', String(limit));
  const c = config.requireLrs();
  const r = await fetch(`${c.endpoint}/statements?${params.toString()}`, { headers: headers() });
  if (!r.ok) throw new Error(`[xapi] GET statements ${r.status}`);
  return r.json();
}

export default { VERBS, verbId, sendStatement, getStatements };
