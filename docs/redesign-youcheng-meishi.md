# 优城美市 · Our Block — Redesign from `优城美市.docx`

> Source: `docs/优城美市.docx` (the product owner's annotated spec — yellow highlights are action items).
> This doc turns those 19 highlighted asks into a concrete design that attaches to the **existing
> kernel** (capture → AI-route `self`/`rally`/`city` → close) without forking it. It supersedes the
> earlier 15-module `enhancement-*.md` plan for *this* batch of asks; that plan describes a different,
> broader scope.

## Principle (unchanged from the integration map)

The kernel — store (`repo.js` CAS `mutate`), LLM gateway, i18n hash registry, xAPI, hash-route
views — stays read-only. Every feature is **(A)** an optional defaulted field on the post/user doc,
**(B)** a new call through the gateway, **(C)** a new role/route beside the loop, or **(D)** a new
view. Remove any feature → the app still runs.

## New shared spine: gamification (`server/gamify.js`)

Points and levels are referenced by half the asks (Thanks, levels, tasks, impact tiers), so they
are built **first** as one tiny module:

```
POINTS = { good:5, care:5, react:1, confirm:3, resolve:20, thanks_give:-5, thanks_get:3 }
LEVELS = Steward(0) · Block Friend(60) · Block Keeper(180) · Block Guardian(400) · Block Legend(900)
```

- `user.pointsEarned` — lifetime gross (never decreases) → drives **level** (so spending Thanks
  never demotes you).
- `user.points` — spendable balance (Thanks debits it).
- `user.badges[]` — `founding-steward`, season badges (`season-2026-summer`…).
- `award(userId, key)` — single chokepoint: mutates the user doc, recomputes level/title, returns
  the fresh user. Called from the post/react/advance/thank routes.

Season = calendar quarter (spring/summer/autumn/winter); month = calendar month. **Counters are
derived** from the post + reaction timestamps (GCS-only, no drift) — only `points`/`pointsEarned`/
`badges` are stored.

## Post-doc additive fields (all optional, defaulted, synthesized on read)

| field | feature | shape |
|---|---|---|
| `mood` | Emotion tag ⑦ | `'happy'|'neutral'|'sad'|'angry'|'anxious'|null` |
| `groups` | Concern-group ⑥ | `string[]` from a fixed vocabulary (elderly, children, …) |
| `claim` | Claim→verify ③ | `{ userId, name, official, at }|null` |
| `verify` | Claim→verify ③ | `{ userId, name, at }|null` |
| `story` | Resolution story ④ | `string|null` (generated on resolve) |
| `thanks` | Thanks ⑤ | `[{ fromId, toId, at }]` |

`status` gains the closure ladder: `open`(待认领) → `claimed`(处理中) → `pending_verify`(待验收) →
`resolved`(已解决). Legacy `rallying`/`routed`/`in_progress` still render.

## Feature → seam map (build order)

1. **Points + levels** (B-spine) — `gamify.js`; award in posts/react/advance routes; surface in
   `publicUser`, `/stats/me`, rail + impact.
2. **Emotion tags ⑦** (A) — `mood`; capture picker; feed/detail icon.
3. **Concern-group tags ⑥** (A) — `groups`; capture multi-select; chips.
4. **Narrative card labels ④** (D) — derived "Today {name} noticed … here" on cards (client-side).
5. **Perspective-taking ⑤(Near me)** (D) — collapsible reflection under Needs-Care detail.
6. **Cheer animation ⑤** (D) — particle burst < 0.6 s on Cheer.
7. **Thanks ⑤** (B/C) — `POST /posts/:id/thank`; points transfer; broadcast in Pulse.
8. **Claim→verify loop ③** (A/C) — advance actions `claim`/`submit_fix`/`verify`; statuses; UI.
9. **Resolution story ④** (B) — gateway call on resolve, template fallback; shown on resolved posts.
10. **Impact tiers ①** (D) — `/stats/me` returns `{lifetime, season, month}`; impact view.
11. **Task system ④** (D) — daily/weekly/season tasks derived from activity; impact checklist.
12. **AI cartoon avatar ③** (B/D) — deterministic generative cartoon SVG seeded by user; the LLM
    optionally picks traits; account modal to regenerate. (Self-contained, no image-gen dependency.)
13. **Founding cold-start ⑧** (C/D) — `founding-steward` badge for the first N users; guided tasks;
    warm empty state.
14. **Location quick-switch (Needs care ①)** (D) — Home / current toggle on the map; `user.home`.
15. **Official/property accounts (Community ①)** (C) — `user.role='official'`, `verified`, `orgName`;
    admin verifies; officials may claim/advance any care item.
16. **Block Pulse (Community ②)** (D) — `/stats/pulse`: today's active neighbours, latest resolution
    stories, open issues needing help, contribution ranking — the three E's in one dashboard.

## Invariants kept

1. Schema append-only & defaulted; old docs upgrade lazily on next `mutate`.
2. Indexes are derived from the `db/posts/` scan — never load-bearing.
3. New roles (`official`) are additive server-side gates, like `admin` (TEACHER_EMAILS) today.
</content>
</invoke>
