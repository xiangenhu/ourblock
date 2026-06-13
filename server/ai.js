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
import { getStyleDirective } from './ai-styles.js';

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

/* ── Post composition ────────────────────────────────────────────────────────
 * From a captured photo and/or the neighbour's short note, suggest a title + a
 * description of 50 words or LESS that they can edit before posting. Vision and
 * text both go through the single gateway. Returns null on any failure so the UI
 * silently falls back to manual entry.
 */
const COMPOSE_SYSTEM =
  'You help a neighbour post a civic observation about their block. ' +
  "From the photo and/or the neighbour's note, write: a short, specific title (max 8 words, no " +
  'quotation marks) and a warm, plain-language description of 50 words or LESS, the way a neighbour ' +
  'would write it. Describe only what is given. ' +
  'Return ONLY JSON: {"title":string,"description":string}.';

/** Trim a string to at most `max` words (adds an ellipsis when it had to cut). */
function capWords(str, max) {
  const words = String(str || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return words.slice(0, max).join(' ').replace(/[,;:.]+$/, '') + '…';
}

/** Like capWords, but keeps line breaks — styled output (poems, verse) needs its lines. */
function capWordsKeepLines(str, max) {
  const lines = String(str || '').replace(/\r/g, '').trim().split('\n');
  const out = [];
  let count = 0;
  for (const line of lines) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (count + words.length <= max) { out.push(line.trim()); count += words.length; continue; }
    out.push(words.slice(0, Math.max(0, max - count)).join(' '));
    break;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** System prompt for a styled rewrite — voice takes priority, but stays grounded in fact. */
function styledSystem(directive) {
  return 'You help a neighbour post a civic observation about their block. ' +
    'From the photo and/or the note, write a title (max 10 words, no quotation marks) and a ' +
    'description of 60 words or LESS. Write BOTH the title and the description in this voice: ' +
    `${directive} ` +
    'Stay grounded in what the photo and note actually show — evoke, but do not invent specific facts. ' +
    'Return ONLY JSON: {"title":string,"description":string}.';
}

export async function composePost({ base64, mediaType, note, stream = 'care', userId, lang, style } = {}) {
  if (!config.has.llm()) return null;
  if (!base64 && !(note && note.trim())) return null; // nothing to work from
  try {
    const directive = style ? getStyleDirective(lang, style) : null;
    const streamLine = stream === 'good'
      ? 'This is for "The Good" stream — something worth savouring.'
      : 'This is for "Needs Care" stream — something to fix or flag.';
    const user = note && note.trim() ? `${streamLine}\nThe neighbour wrote: "${note.trim()}"` : streamLine;
    const txt = await callLLM({
      feature: directive ? 'compose-style' : 'compose',
      userId,
      lang,
      maxTokens: directive ? 360 : 220,
      json: true,
      system: directive ? styledSystem(directive) : COMPOSE_SYSTEM,
      user,
      image: base64 ? { base64, mediaType: mediaType || 'image/jpeg' } : undefined,
    });
    if (!txt) return null;
    const json = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const rawTitle = String(json.title || '').replace(/^["']+|["']+$/g, '').replace(/\s*\n\s*/g, ' ');
    if (directive) {
      const title = capWordsKeepLines(rawTitle, 12).slice(0, 140);
      const description = capWordsKeepLines(String(json.description || ''), 70).slice(0, 700);
      if (!title && !description) return null;
      return { title, description, style };
    }
    const title = capWords(rawTitle, 10).slice(0, 120);
    const description = capWords(String(json.description || ''), 50).slice(0, 400);
    if (!title && !description) return null;
    return { title, description };
  } catch {
    return null;
  }
}

// Back-compat alias for the photo-only capture path.
export const describeImage = composePost;

export { heuristic };
