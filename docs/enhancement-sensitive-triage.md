# Sensitive-Event Triage Spec (Module #15)

> Companion to [`enhancement-evidence-thread.md`](./enhancement-evidence-thread.md) and
> [`enhancement-integration-map.md`](./enhancement-integration-map.md).
>
> The only Phase-1 module that is a **safety prerequisite**, not a feature. It must ship before
> any real-user pilot, because a community-feedback app inevitably receives reports of domestic
> violence, animal abuse, self-harm risk, crime, and doxxing — and today those go **straight to
> the public feed with no review** (`server/routes/posts.js` publishes on create).

## 1. Where it hooks — one call, no kernel change

Today's create path (`posts.js` `router.post('/')`):

```
validate → getViewer → classify() → posts.create() → seed loop → return shapePost
```

Triage adds exactly one pre-publish gate, run **in parallel with `classify()`** so it adds no
latency on the common (clear) path:

```js
// in posts.js create handler, replacing the lone `classify` call:
const [ai, risk] = await Promise.all([
  classify({ stream, title, body, userId: req.userId }),
  triage({ stream, title, body, userId: req.userId }),   // new export from ai.js
]);

if (risk.level === 'high') {
  // never reaches the public feed
  const ref = await quarantine.create({ stream, title, body, mediaUrl, lat, lng,
                                        userId: req.userId || null, risk });
  if (req.userId) events.triaged(viewer, ref, risk.category);  // logs category only, never body
  return res.status(202).json({ triaged: true, referral: REFERRALS[risk.category] || REFERRALS.default });
}

// 'sensitive' and 'clear' both publish, but 'sensitive' carries redaction flags (see §4)
const post = await posts.create({ ..., sensitivity: risk });
```

This follows the integration-map rule: a **new call through an existing chokepoint**
(`gateway.js` via `ai.js`). The kernel loop is untouched; remove `triage` and the app behaves
exactly as today.

## 2. Risk taxonomy

Matches proposal §15, with child-safety added (non-negotiable for any platform accepting
user media):

| category | examples | default level |
|---|---|---|
| `self_harm` | suicidal ideation, intent to self-harm | high |
| `domestic_violence` | abuse at home, partner/family violence | high |
| `child_safety` | child endangerment, CSAM, exploitation | high |
| `crime_in_progress` | active assault, threat to life, weapons | high |
| `animal_abuse` | cruelty, neglect, abandonment | high → sensitive (severity-dependent) |
| `doxxing_privacy` | a named/identifiable private person, license plates, faces of bystanders, home addresses | sensitive |
| `harassment` | targeted abuse of an individual or business | sensitive |
| `none` | ordinary civic observation | clear |

## 3. Three levels and what each does

| level | feed? | rewards? | what happens |
|---|---|---|---|
| `clear` | yes | yes | normal publish — today's behavior |
| `sensitive` | yes, **redacted** | **no** | publish but: precise location coarsened to `placeId` cell only; no coupon eligibility; flagged for ambassador/admin review; AI narrative assistant offered to de-identify |
| `high` | **never** | no | not published; stored to quarantine namespace; user shown a **referral** (helpline/authority), not a post |

The `high` path deliberately returns **HTTP 202** with a `referral`, not a 4xx error — the user
did nothing wrong; we are routing them to help, not rejecting them.

## 4. The `triage()` function — gateway + fail-safe fallback

Mirrors the existing `classify()` pattern in `ai.js`: ask the model through the single gateway,
fall back to a transparent heuristic when no LLM is configured **or the call fails**.

```js
const TRIAGE_SYSTEM =
  'You screen short civic posts for safety risk BEFORE they are published publicly. ' +
  'Return ONLY JSON: {"level":"clear"|"sensitive"|"high","category":string,"confidence":number,' +
  '"reason":string}. ' +
  '"high" = self-harm, domestic violence, child safety, crime-in-progress, or severe animal abuse — ' +
  'content that must NOT be public and needs a referral. ' +
  '"sensitive" = identifies a private individual, doxxing, faces/plates, or harassment — ' +
  'publishable only after de-identification. "clear" = ordinary neighbourhood observation. ' +
  'When uncertain between two levels, choose the HIGHER risk.';

// Keyword backstop so an LLM outage still catches the obvious cases.
const HIGH_RISK_RE =
  /\b(suicide|kill myself|end my life|self.?harm|beaten|abuse|hitting|拳打|自杀|家暴|虐待|molest|trafficking)\b/i;

export async function triage(input) {
  const viaLLM = await triageViaGateway(input);   // null on no-config OR failure
  if (viaLLM) return viaLLM;
  // Fallback stance — see §5:
  if (HIGH_RISK_RE.test(`${input.title} ${input.body || ''}`))
    return { level: 'high', category: 'unclassified', confidence: 0.5, reason: 'keyword backstop' };
  return { level: 'clear', category: 'none', confidence: 0.4, reason: 'no signal' };
}
```

`triageViaGateway` uses `callLLM({ feature: 'triage', json: true, maxTokens: 200, ... })`,
parses the JSON the same defensive way `classify` does, and returns `null` on any throw.

## 5. The fail-open / fail-closed decision (must be made explicitly)

The moderation call is the one place where a gateway failure is dangerous. Two options:

- **Fail-open** (recommended default): on LLM failure, the keyword backstop catches obvious
  high-risk terms; everything else publishes. Rationale — blocking *all* posts during an LLM
  outage breaks the app, and the keyword list + post-publish ambassador review (Group C) is a
  reasonable second net.
- **Fail-closed**: on LLM failure, route *everything* to quarantine. Safer, but turns any model
  outage into a total publish freeze.

Recommendation: **fail-open with the keyword backstop for v1**, revisit once ambassadors (#12)
exist to staff a review queue. This is an explicit, logged tradeoff — not an accident. Log every
fail-open event so the rate is visible.

## 6. Quarantine storage (GCS-only, kept out of the feed scan)

Quarantined items are stored under a **separate prefix** so they never appear in the feed's
`listByPrefix('db/posts/')` scan — the isolation is structural, not a filter that could be
forgotten:

```
db/quarantine/{id}.json   -> { id, createdAt, userId, stream, title, body, mediaUrl, lat, lng,
                               risk:{level,category,confidence,reason},
                               review:{ state:'pending'|'released'|'kept'|'referred', by, ts, note } }
```

- `media` for a quarantined item stays in the existing `media/` bucket but is **never served on a
  public route** — only the admin review route can read it.
- `release` moves the item into `db/posts/` (re-running `classify` + applying `sensitive`
  redaction); `kept` leaves it quarantined; `referred` records that a human routed it onward.

## 7. Referral contract

A small server-side table (not user-editable), localized through the existing `i18n.js` registry:

```js
const REFERRALS = {
  self_harm:         { title: '…', body: '…', contacts: [{ label: 'The Samaritans HK', tel: '...' }] },
  domestic_violence: { ... },
  child_safety:      { ... },
  crime_in_progress: { title: 'If someone is in danger, call 999 now.', contacts: [...] },
  default:           { title: 'This may need direct support.', contacts: [...] },
};
```

HK-specific contacts to be confirmed with the project owner before launch (open decision §10).

## 8. Admin / ambassador review queue

A new role-gated namespace (Group C pattern — derived server-side, never client-asserted; reuses
the `TEACHER_EMAILS` → admin mechanism in `auth.js`, extended later to the `ambassador` trust
tier):

```
GET   /api/admin/quarantine            -> pending items (no media inline; signed media URLs)
POST  /api/admin/quarantine/:id/release
POST  /api/admin/quarantine/:id/keep
POST  /api/admin/quarantine/:id/refer  { note }
```

## 9. Privacy & data-handling rules (these are invariants, not suggestions)

1. **Never log sensitive bodies.** `events.triaged(...)` and any server log record the
   **category and level only** — never the post text. The proposal's §9 minimization principle
   applied at the code level.
2. **No public media for quarantined items.** The public `/api/media/:file` route must refuse
   files belonging to quarantined posts (check an allowlist or a `quarantined` marker).
3. **Coarsen location for `sensitive`.** Store only the `placeId` cell, not raw lat/lng, on
   sensitive posts — consistent with the evidence-thread placeId design.
4. **Retention.** Quarantined items auto-expire (e.g. 90 days) unless `referred`; document the
   window. They are evidence of a safety event, not content to retain indefinitely.

## 10. Open decisions

- **Fail-open vs fail-closed** (§5) — recommend fail-open v1; needs owner sign-off.
- **HK referral contacts** (§7) — must be real, current helpline/authority numbers; owner to provide.
- **Image moderation** — v1 triages text only (title + body). Vision-based triage of the photo
  itself (faces, plates, graphic content) is heavier; defer to v2, route through the same gateway
  `image` param already supported by `composePost`.
- **Severity split for `animal_abuse`** — high vs sensitive is judgment-dependent; pick a default.

## 11. Test cases (acceptance)

| input | expected |
|---|---|
| "Broken streetlight on Nathan Rd" | `clear` → published, today's behavior unchanged |
| "My husband hit me again last night" | `high` → not published, 202 + DV referral, quarantined |
| Photo of a named person + "this man is a thief" | `sensitive` → published redacted, no coupon, review-flagged |
| "I want to end my life" | `high` → self-harm referral, quarantined |
| LLM disabled, "kill myself" in body | `high` via keyword backstop → quarantined |
| LLM disabled, ordinary report | `clear` (fail-open) → published, fail-open event logged |
