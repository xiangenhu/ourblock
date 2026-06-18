# Integration Map — Existing App as Kernel + 15 Enhancements

> Companion to [`enhancement-evidence-thread.md`](./enhancement-evidence-thread.md).
> This doc answers one question: **how do we add all 15 proposed modules without forking the
> civic loop that already works?**

## The principle

The existing app's core loop — **capture → AI-route (`self`/`rally`/`city`) → close** — plus its
store, LLM gateway, i18n, and xAPI instrumentation, is the **kernel**. It is treated as
read-only. Every enhancement attaches at an existing seam.

> **The rule:** No module modifies kernel behavior. Each one is either (A) an optional, defaulted
> field on the post doc, (B) a new call through an existing chokepoint, (C) a new route namespace
> + role beside the loop, or (D) a new hash-route view. **If you removed any module, today's app
> must still run unchanged.**

## The five seams that make this possible

The codebase already centralizes everything into five clean extension points. Every module plugs
into one of them; none requires a new architectural layer.

| Seam | File(s) | What plugs in |
|---|---|---|
| **Data spine** | `server/store/repo.js`, `server/store/gcs.js` (CAS `mutate`, `listByPrefix`) | anything that stores or queries |
| **Model chokepoint** | `server/llm/gateway.js` | anything AI |
| **Classification router** | `server/ai.js` | anything that inspects a post pre-publish |
| **Translation** | `server/i18n.js` (hash registry) | anything multilingual |
| **View router** | `public/js/app.js` (`location.hash`) | any new screen |

Plus role-gating via `server/auth.js` (`TEACHER_EMAILS` → admin), which generalizes to new roles
(`merchant`, `ambassador`) — all derived server-side, never client-asserted.

## The 15 modules, grouped by attachment type

### Group A — Optional fields on the post doc (the Evidence Thread)

Kernel untouched: every field defaults to today's behavior, and `getById`/feed-shaping synthesize
them on read for old docs. See the evidence-thread spec for the full data model.

| # | Module | Additive change | Touches kernel? |
|---|---|---|---|
| 3 | Location evidence chain | `events[]` (promoted `loop[]`) + `placeId` | No |
| 4 | Before/After verification | pairs `report.media` vs first `after.media` — pure read | No |
| 5 | Nearby cross-confirmation | `confirm`/`dispute` events + `needs-confirm` index | No |
| 2 | Good / Needs Care 2.0 | already the kernel; tier the existing two streams | — (is kernel) |

### Group B — New calls through the gateway / router

Zero schema change. The loop doesn't know these ran.

| # | Module | Plugs in as |
|---|---|---|
| 15 | Sensitive-event triage | one pre-publish `ai.js` call on the `report` event; high-risk → quarantine + referral, never reaches the feed |
| 1 | Voice-first feedback | STT → `gateway.js` → fills the *existing* title/body draft (same pattern as the photo-describe call) |
| 14 | AI narrative assistant | extend `ai-styles.js` from "rewrite in a voice" → "turn venting into constructive, place-bound feedback" |
| 9 | Multilingual | already implemented via `i18n.js`; the only addition is content-localization of curated strings |

### Group C — New role + new route namespace, beside the loop

Reads/writes the same store; never edits the civic routes.

| # | Module | New surface |
|---|---|---|
| 10 | Merchant/property backend | `merchant` role + `/api/merchant/*`, reading `open-care` filtered by `placeId` proximity; SLA = `lastEventTs − createdAt` |
| 11 | Positive-feedback coupons | a listener that fires on `verification.state === 'resolved'` — not a loop edit |
| 12 | Community ambassadors | a trust tier (`user.trust`), same derivation pattern as the existing admin allowlist |
| 13 | Anonymized dashboard | read-only aggregates over `by-place/*` with a server-enforced k-anonymity gate |

### Group D — New hash-route views + a settings profile

Pure frontend addition in `app.js`.

| # | Module | New view |
|---|---|---|
| 8 | Elder-friendly mode | a profile flag → CSS variant + voice entry; no new data |
| 6 | Task / mission map | a `#tasks` view over `open-care` / `by-place` |
| 7 | Avatars & levels | activates the dormant `user.level` / `user.avatar` fields; gamifies *verification*, not post volume |

## The three invariants that keep "core" actually core

1. **Schema is append-only & defaulted.** New post fields are optional; old docs are upgraded
   lazily on next `mutate` and synthesized on read meanwhile. The `listByPrefix` feed scan never
   changes shape.
2. **Indexes are a cache, not truth.** All Group A/C index objects (`by-place/*`, `open-care`,
   `needs-confirm`) are derived from the `db/posts/` scan and rebuildable by a reconcile job. The
   kernel never depends on an index existing.
3. **New roles are additive gates, not rewrites.** `merchant` / `ambassador` are derived
   server-side like `admin` is today. The anonymous → user → admin request path still works
   untouched if every new role is deleted.

## Build order (also the dependency order)

1. **Evidence Thread (Group A) + triage (B #15)** — the loop now produces *verified* closures.
   *Safety prerequisite + the commercial moat.*
2. **Merchant + coupons + dashboard (Group C)** — a payer consumes the verified data. *Revenue.*
3. **Voice + elder + narrative (B/D)** — the inclusion layer rides on a loop that closes. *社会共融.*
4. **Task map / avatars (D)** — gamify verification and closure, not post volume.

### One prerequisite before Group C

`public/js/app.js` is ~2000 lines in a single file. Split it into per-view modules **before**
adding the merchant console and dashboard, or those two will make it unmaintainable. Cheap now,
painful later — and it is the one piece of kernel-adjacent work the original proposal does not
mention.

## One-line summary

The existing app stays as a kernel you never edit. Thirteen of the fifteen modules are
field-adds, gateway-calls, side-namespaces, or new views; only the **Evidence Thread** and the
**`app.js` split** are foundational — and the evidence thread is already specced.
