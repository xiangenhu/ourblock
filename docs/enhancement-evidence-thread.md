# Evidence Thread — Data Model & GCS Index Spec

> The load-bearing piece of the enhancement plan. Build this once and Before/After (#4),
> location evidence chain (#3), nearby cross-confirmation (#5), merchant trend reports (#10),
> and the anonymized dashboard (#13) all become *queries over the same structure* rather than
> new subsystems.

## 1. Where we are today (verified against code)

A post (`server/store/repo.js → posts.create`) is a self-contained JSON doc at `db/posts/{id}.json`:

```
{ id, userId, stream:'good'|'care', title, body, mediaType, mediaUrl, durationS,
  lat, lng, placeName, ai:{tag,category,action,confidence,summary},
  status:'open', createdAt, author, reactions[], comments[],
  loop:[{id,label,status,position,detail,createdAt}], seq:{comment,loop} }
```

Key facts that constrain the design:

- **GCS-only, no DB.** Listing the feed is a single `listByPrefix('db/posts/')` scan; there are
  no secondary indexes. Mutations race-safely via `store.mutate(key, init, transform)` — a CAS
  loop using GCS `ifGenerationMatch` (`server/store/gcs.js`).
- **`lat`/`lng` are device geolocation at capture**, passed from the client in the create body
  (`server/routes/posts.js`). There is **no EXIF extraction** and no photo↔location binding.
  The only distance logic is `helpers.js distanceMeters` (haversine), used to *reveal* nearby
  posts — not to verify them.
- **The `loop[]` array is already a proto-thread**: ordered steps with status. We extend this
  rather than inventing a new container.

So the gap isn't "we have no events" — it's that the loop steps carry no media, no geo-stamp,
no author, and no notion of *who verified them*.

## 2. Target model: the post IS the thread

Promote `loop[]` from labels to **evidence events**, and add a stable `placeId` plus a
`verification` block. Backward-compatible: every new field is optional/defaulted, so existing
docs keep working and the feed scan is unchanged.

```jsonc
{
  // ...all existing fields unchanged...
  "placeId": "wx4g0bm",            // geohash @ precision 7 (~76m cell) of (lat,lng)
  "kind": "report",                // first event's type; mirrors stream/ai for fast filtering

  "events": [                       // replaces/augments loop[]; chronological
    {
      "id": 1,
      "type": "report",            // report | progress | after | confirm | dispute
      "authorId": "u_123",
      "ts": "2026-06-17T...Z",
      "media": { "url": "/api/media/<uuid>.jpg", "mediaType": "photo", "photoHash": "sha256:..." },
      "gps": { "lat": 22.3, "lng": 114.1, "accuracyM": 12 },
      "geoVerified": true,         // gps within ACCEPT_RADIUS_M of post.placeId centroid
      "label": "Reported with photo + GPS",
      "detail": null,
      "status": "done"             // keep for UI continuity with current loop rendering
    }
  ],

  "verification": {
    "state": "unverified",          // unverified | confirmed | resolved | disputed
    "confirmCount": 0,              // distinct nearby users who confirmed it's real
    "resolveCount": 0,             // distinct nearby users who confirmed the AFTER
    "lastEventTs": "..."
  },

  "seq": { "comment": 0, "event": 1 }   // 'loop' renamed to 'event'; keep 'loop' alias on read
}
```

### Event types

| type | who can add | meaning | required |
|---|---|---|---|
| `report` | owner (auto on create) | the initial observation | media + gps |
| `progress` | owner | work underway | detail; media optional |
| `after` | owner | the fix — the "After" photo | media + gps |
| `confirm` | **nearby non-owner** | "I'm here, this is real" | gps only |
| `dispute` | nearby non-owner / merchant | "not real / not fixed" | gps + reason |

Before/After is simply: the `report` event's media vs. the first `after` event's media. No
separate subsystem — the UI pairs them.

### Evidence hardening (closes the self-asserted-location gap)

- **`photoHash`**: sha256 of the uploaded bytes, computed in `routes/upload.js` (we already hold
  the buffer in memory via Multer). Lets the dashboard dedupe and detect reused photos.
- **`geoVerified`**: server compares the event's `gps` to the post's `placeId` centroid using the
  existing `distanceMeters`. `true` only if within `ACCEPT_RADIUS_M` (start at 150m). This is the
  honest version of "evidence" — the device GPS at the moment of capture, checked against the
  place, not blindly trusted.
- EXIF GPS extraction is a **later hardening** (optional dependency); the geoVerified check on
  live device GPS gives 80% of the value with none of the EXIF-stripping edge cases.

## 3. The place-id and the secondary indexes

`placeId = geohash(lat, lng, precision=7)`. Pure function, no deps worth importing — ~15 lines.
Precision 7 ≈ a 76m × 152m cell, which is the right grain for "the same broken railing reported
five times."

Because GCS has no queries, **maintained index objects** are the substitute. Update them in the
same `store.mutate` CAS pattern already used for reactions/loop — write to the index in the same
request that writes the post.

```
db/index/by-place/{placeId}.json     -> { placeId, centroid:{lat,lng}, postIds:[...], openCount, lastTs }
db/index/open-care.json              -> { ids:[...] }            // care posts not yet 'resolved'
db/index/needs-confirm.json          -> { ids:[...] }            // unverified, awaiting nearby confirm
```

Why these three specifically:
- `by-place/*` → merchant trend report ("this spot, 5× this month") and dashboard heatmap, **for free**.
- `open-care` → the merchant/property work queue (Tier 2) is a read of this list filtered by `placeId` proximity.
- `needs-confirm` → drives the nearby cross-confirmation prompt (#5) without scanning all posts.

**Index maintenance rule:** every write that changes `verification.state` or adds an event must,
in the same handler, `store.mutate` the relevant index. If an index write fails, the post write
still succeeds (indexes are derived, not source of truth) — and a periodic reconcile job can
rebuild any index from the `db/posts/` scan. This keeps GCS-only honest: indexes are a cache, the
post docs are truth.

## 4. Nearby cross-confirmation (#5) — reuses what exists

The visibility gate already answers "is this viewer near this post?" (`distanceMeters` ≤ ~1.2km).
Reuse the *same predicate* to gate the verify action:

1. A signed-in user within `CONFIRM_RADIUS_M` (start 300m) of an `unverified` post sees a
   **"You're nearby — is this real?"** prompt (sourced from `needs-confirm.json`).
2. `confirm`/`dispute` appends an event (with their gps, `geoVerified` checked) and bumps
   `verification.confirmCount`. Distinct authors only — dedupe on `authorId`.
3. At `CONFIRM_THRESHOLD` (start 2) → `verification.state='confirmed'`; remove from `needs-confirm`.
4. Same mechanic on `after` events drives `resolveCount` → `state='resolved'`.

This is the moat: a `resolved` post is one a *merchant can be billed against*, because closure was
witnessed by independent nearby users, not self-declared.

Anti-gaming (from proposal §9), all cheap to add here:
- owner cannot confirm own post; confirmers must be `geoVerified`.
- **delayed reward**: coupons/points fire on `state='resolved'`, after a short public window, not on post.
- reuse `user` reputation: new accounts need more confirmers; trusted users count as fast-track
  (a `user.trust` field; the `level`/`avatar` scaffolding already exists).

## 5. Migration (no DB, no downtime)

1. **Read-compat shim**: in `posts.getById`/feed shaping, if `events` is absent, synthesize it
   from `loop[]` on read. New writes populate `events`; old docs are upgraded lazily on next mutate.
2. **Backfill job**: one pass of `listByPrefix('db/posts/')` to compute `placeId` for existing
   posts and build the three indexes. Idempotent; safe to re-run (it's also the reconcile job).
3. Keep `loop` as a read alias of `events` for one release so `public/js/app.js` detail view keeps
   rendering while the frontend migrates.

## 6. API surface (minimal additions)

```
POST /api/posts/:id/events      { type, mediaUrl?, lat, lng, detail? }   // owner: progress/after
POST /api/posts/:id/confirm     { lat, lng }                              // nearby: confirm
POST /api/posts/:id/dispute     { lat, lng, reason }                      // nearby: dispute
GET  /api/places/:placeId       -> { centroid, posts[], openCount, trend } // merchant/dashboard
GET  /api/confirm/nearby?lat&lng -> [ posts from needs-confirm within radius ]
```

All write paths go through `store.mutate` for CAS; all live-model needs (none here yet) would go
through `server/llm/gateway.js`. Sensitive-event triage (#15) slots in as a pre-publish gateway
call on the `report` event before the post becomes visible.

## 7. What this unlocks, in one table

| Downstream module | Becomes… |
|---|---|
| #3 Location evidence chain | the `events[]` array itself |
| #4 Before/After | `report.media` vs first `after.media` |
| #5 Nearby cross-confirmation | `confirm`/`dispute` events + `needs-confirm` index |
| #10 Merchant backend | a filtered read of `open-care` by `placeId` proximity; SLA = `lastEventTs - createdAt` |
| #11 Coupons | trigger on `verification.state='resolved'` |
| #13 Dashboard | aggregates over `by-place/*` (emit only k≥N buckets) |

## 8. Open decisions (need a call before coding)

- **Geohash precision** — 7 (~76m) vs 8 (~19m). 7 groups a streetcorner; 8 groups a single
  doorway. Recommend 7 for civic infra, but merchant-street pilots may want 8.
- **Confirm thresholds & radii** — starting values above are guesses; tune in Phase-1 pilot.
- **Index write failure policy** — proposed "post wins, index is cache + reconcile job." Confirm
  that's acceptable vs. strict transactional coupling (which GCS can't give us cheaply anyway).
