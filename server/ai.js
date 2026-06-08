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
 * If ANTHROPIC_API_KEY is set the classifier asks Claude; otherwise it falls
 * back to a transparent keyword heuristic so the app is fully functional with
 * zero configuration.
 */

const MODEL = 'claude-opus-4-8';

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

async function viaClaude(input) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system:
          'You route civic observations to the lowest viable rung of action. ' +
          'Return ONLY JSON: {"tag":string,"category":string,"action":"self"|"rally"|"city",' +
          '"agency":string,"confidence":number,"summary":string}. ' +
          'tag is a short label like "AI: broken light". "self" = fix yourself, ' +
          '"rally" = organise neighbours, "city" = send to an agency. ' +
          'The Good stream should always use "self".',
        messages: [
          {
            role: 'user',
            content: `stream=${input.stream}\ntitle=${input.title}\nbody=${input.body || ''}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt = data?.content?.[0]?.text || '';
    const json = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    if (!['self', 'rally', 'city'].includes(json.action)) return null;
    return json;
  } catch {
    return null;
  }
}

export async function classify(input) {
  return (await viaClaude(input)) || heuristic(input);
}

export { heuristic };
