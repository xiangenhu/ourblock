/**
 * AI action-router.
 *
 * Maps each observation to (1) a human-readable tag, (2) a category, and
 * (3) the *lowest viable rung* of the action ladder:
 *     self  → fix-it-yourself
 *     rally → rally neighbours
 *     city  → send a report to the responsible agency
 *
 * This is the "learned hopefulness" mechanism from the design: every issue
 * stays coupled to a concrete path to act.
 *
 * If an LLM vendor is configured (LLM_VENDOR + key), the classifier asks the model
 * through the single LLM gateway; otherwise it falls back to a transparent keyword
 * heuristic so the app is fully functional with zero configuration.
 */

import config from './config.js';
import { callLLM } from './llm/gateway.js';

const RULES = [
  // category, regex, default action, suggested agency
  { cat: 'lighting',   re: /\b(light|lamp|streetlight|street light|dark|bulb|路灯|灯)\b/i, action: 'city',  agency: 'District Works (Lighting)' },
  { cat: 'pavement',   re: /\b(pavement|sidewalk|pothole|crack|paving|curb|kerb|路面|人行道)\b/i, action: 'city', agency: 'District Works (Roads)' },
  { cat: 'waste',      re: /\b(trash|garbage|litter|rubbish|dump|bin|waste|垃圾)\b/i, action: 'rally', agency: 'Sanitation' },
  { cat: 'graffiti',   re: /\b(graffiti|tag|vandal|spray|涂鸦)\b/i, action: 'rally', agency: 'Public Space' },
  { cat: 'water',      re: /\b(leak|flood|water|drain|sewer|puddle|积水|漏水)\b/i, action: 'city', agency: 'Water Authority' },
  { cat: 'greenery',   re: /\b(garden|tree|plant|flower|bloom|green|park|花园|绿化|树)\b/i, action: 'self', agency: 'Parks' },
  { cat: 'community art', re: /\b(mural|art|paint|repaint|underpass|壁画|彩绘)\b/i, action: 'self', agency: 'Public Space' },
  { cat: 'safety',     re: /\b(unsafe|danger|hazard|broken|fall|trip|危险|破损)\b/i, action: 'city', agency: 'District Works' },
  { cat: 'gathering',  re: /\b(market|festival|event|gather|neighbour|neighbor|volunteer|集市|活动|志愿)\b/i, action: 'rally', agency: 'Community' },
];

function heuristic({ title = '', body = '', stream = 'good' }) {
  const text = `${title} ${body}`;
  let match = RULES.find((r) => r.re.test(text));

  if (!match) {
    match = stream === 'good'
      ? { cat: 'neighbourhood life', action: 'self', agency: 'Community' }
      : { cat: 'general upkeep', action: 'rally', agency: 'District Works' };
  }

  // The Good stream never needs the city — it is a savoring stream.
  let action = stream === 'good' ? 'self' : match.action;

  const tag = stream === 'good'
    ? `AI: ${match.cat}`
    : `AI: ${match.cat}`;

  const summary = action === 'city'
    ? `Drafted a report for ${match.agency}. Tap to send — or rally neighbours first.`
    : action === 'rally'
      ? `Looks like something neighbours can take on together. Rally a few people nearby.`
      : `Small enough to tend yourself — share it so others can savour or join.`;

  return {
    tag,
    category: match.cat,
    action,
    agency: match.agency,
    confidence: match ? 0.78 : 0.5,
    summary,
  };
}

const SYSTEM =
  'You route civic observations to the lowest viable rung of action. ' +
  'Return ONLY JSON: {"tag":string,"category":string,"action":"self"|"rally"|"city",' +
  '"agency":string,"confidence":number,"summary":string}. ' +
  'tag is a short label like "AI: broken light". "self" = fix yourself, ' +
  '"rally" = organise neighbours, "city" = send to an agency. ' +
  'The Good stream should always use "self".';

/** Ask the configured model via the single gateway. Returns null on any failure. */
async function viaGateway(input) {
  if (!config.has.llm()) return null;
  try {
    const txt = await callLLM({
      feature: 'classify',
      userId: input.userId,
      maxTokens: 300,
      json: true,
      system: SYSTEM,
      user: `stream=${input.stream}\ntitle=${input.title}\nbody=${input.body || ''}`,
    });
    if (!txt) return null;
    const json = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    if (!['self', 'rally', 'city'].includes(json.action)) return null;
    return json;
  } catch {
    return null;
  }
}

export async function classify(input) {
  return (await viaGateway(input)) || heuristic(input);
}

/* ── Photo understanding ─────────────────────────────────────────────────────
 * Given a captured photo, suggest a title + description the neighbour can edit
 * before posting. Vision goes through the same single gateway (image option).
 * Returns null on any failure so the UI silently falls back to manual entry.
 */
const DESCRIBE_SYSTEM =
  'You help a neighbour post a civic observation about their block from a photo. ' +
  'Look at the image and produce: a short, specific title (max 8 words, no quotation marks) ' +
  'and a warm, plain-language description of one or two sentences, written the way a neighbour ' +
  'would. Describe only what is visible. ' +
  'Return ONLY JSON: {"title":string,"description":string}.';

export async function describeImage({ base64, mediaType, stream = 'care', userId, lang } = {}) {
  if (!config.has.llm() || !base64) return null;
  try {
    const txt = await callLLM({
      feature: 'describe',
      userId,
      lang,
      maxTokens: 250,
      json: true,
      system: DESCRIBE_SYSTEM,
      user: stream === 'good'
        ? 'This is for "The Good" stream — something worth savouring.'
        : 'This is for "Needs Care" stream — something to fix or flag.',
      image: { base64, mediaType: mediaType || 'image/jpeg' },
    });
    if (!txt) return null;
    const json = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const title = String(json.title || '').trim().slice(0, 120);
    const description = String(json.description || '').trim().slice(0, 500);
    if (!title && !description) return null;
    return { title, description };
  } catch {
    return null;
  }
}

export { heuristic };
