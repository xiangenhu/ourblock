/**
 * xapi/events.js — Our Block civic events → xAPI statements.
 *
 * Maps the app's actions onto the verb taxonomy (no inventing verbs):
 *   - observed a place / posted        → generated   (created a record)
 *   - reacted (cheer/help/metoo)        → interacted
 *   - viewed a post                     → viewed
 *   - advanced the action loop          → completed   (closing the loop)
 *   - signed in / out                   → logged-in / logged-out
 *
 * emit() NEVER throws and never blocks the caller — analytics must not break a civic action.
 * Fire it without awaiting (or await with .catch). Long text goes in context.extensions,
 * never in result.response (project xAPI rule).
 */
import config from '../config.js';
import xapi from './client.js';

const APP = () => config.lrs.appUrl;

function actor(user) {
  // Pseudonymous account identity (team-privacy: avoid raw email as the primary identifier).
  return {
    objectType: 'Agent',
    name: user?.name || 'Neighbour',
    account: { homePage: APP(), name: String(user?.id ?? 'anonymous') },
  };
}

function activity(id, name, type = 'http://activitystrea.ms/schema/1.0/note') {
  return {
    objectType: 'Activity',
    id: `${APP()}/${id}`,
    definition: { name: { 'en-US': String(name || '').slice(0, 250) }, type },
  };
}

async function send(stmt) {
  if (!config.has.lrs()) return; // LRS not configured → no-op
  try {
    await xapi.sendStatement(stmt);
  } catch {
    /* best-effort: swallow */
  }
}

const stamp = (verb, user, object, extra = {}) => ({
  actor: actor(user),
  verb: { id: xapi.verbId(verb), display: { 'en-US': verb } },
  object,
  ...extra,
});

// ── Public emitters (fire-and-forget) ────────────────────────────────────────
export function postCreated(user, post) {
  return send(
    stamp('generated', user, activity(`post/${post.id}`, post.title), {
      context: {
        extensions: {
          [`${APP()}/ext/stream`]: post.stream,
          [`${APP()}/ext/ai-action`]: post.ai_action || post.ai?.action || null,
          [`${APP()}/ext/ai-category`]: post.ai_category || post.ai?.category || null,
          [`${APP()}/ext/place`]: post.place_name || post.placeName || null,
        },
      },
      result: { completion: false },
    })
  );
}

export function reacted(user, post, type) {
  return send(
    stamp('interacted', user, activity(`post/${post.id}`, post.title), {
      context: { extensions: { [`${APP()}/ext/reaction`]: type } },
    })
  );
}

export function viewedPost(user, post) {
  return send(stamp('viewed', user, activity(`post/${post.id}`, post.title)));
}

export function loopAdvanced(user, post, action, resolved) {
  return send(
    stamp(resolved ? 'completed' : 'interacted', user, activity(`post/${post.id}`, post.title), {
      context: { extensions: { [`${APP()}/ext/loop-action`]: action } },
      result: { completion: !!resolved },
    })
  );
}

export function loggedIn(user) {
  return send(stamp('logged-in', user, activity('session', 'Our Block session', 'http://adlnet.gov/expapi/activities/profile')));
}

export function loggedOut(user) {
  return send(stamp('logged-out', user, activity('session', 'Our Block session', 'http://adlnet.gov/expapi/activities/profile')));
}

export default { postCreated, reacted, viewedPost, loopAdvanced, loggedIn, loggedOut };
