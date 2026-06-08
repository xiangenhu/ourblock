# Shared Reference: Cache Invariants (NEVER VIOLATE)

Canonical source for cache-key rules. Referenced by `/team-cache`, `/team-content`,
`/team-performance`, `/team-gcs` via `@.claude/commands/_shared/cache-invariants.md` so the rules cannot drift.

- **Identical inputs produce identical keys** across every call site — the #1 cache bug is two
  paths that should hit but don't.
- **Keys exclude session/runtime noise** (user identity, timestamp, request ID) unless the value
  is genuinely user-specific.
- **Mutable upstream data is read fresh** — cache the *result*, not the *source* it derives from.
- **Invalidation has a clear trigger** — never rely on TTL alone for correctness-critical data.
- **Stale-while-revalidate is opt-in**, not the default.
- **Misses must not stampede** — single-flight / request coalescing for expensive misses.
- **Language is part of the key** for any localized content.

Hit-rate defaults: hot >90%, warm >70%, cold/long-tail >40%.

## Variant-pool cache for LLM responses (CACHE_MAX)
Implemented at the gateway (`runtime/src/llm/cache.js`). Per unique request hash, keep up to
**CACHE_MAX** response *variants*; serving policy: 0 cached → generate synchronously (store #1);
0 < n < MAX → **serve a random cached variant now, background-generate one more**; n ≥ MAX → serve
cached, no generation. Bounds cost to ≤ CACHE_MAX generations per request, then ~0, and gives
phrasing variety. Language is in the key by construction (the gateway hashes the final system+user
*after* injecting the language directive), so a `zh` reader can never be served an `en` variant.

**Store choice — recommend GCS, not the learning LRS.** The serving cache is data-shaped, not a
learning record. Putting it in the learning LRS pollutes learning analytics and fights the
"targeted queries only" rule. Default backend is **gcs** (consistent with the help/content caches
and storage-invariants). If you want it in xAPI, use a **dedicated cache LRS** (`LLM_CACHE_LRS_*`),
never the learning LRS — the `lrs` backend stores each variant as a `generated` statement with
`object.id = {APP_URL}/llm-cache/{hash}` (a targeted, queryable activity).

**Only pool PII-free, context-complete, idempotent requests.** Never pool personalized, stateful
(multi-turn), tool-using, or learner-PII prompts — a pooled variant is served to whoever matches
the hash (team-privacy). The hash must include everything that should differentiate a correct answer.
