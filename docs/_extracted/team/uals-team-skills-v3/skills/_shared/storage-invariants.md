# Shared Reference: Storage Invariants (GCS-only persistence)

**Project invariant.** Canonical here; pulled into gcs, database, i18n, cache, content, backup,
privacy via `@.claude/commands/_shared/storage-invariants.md`.

## The hard rules
1. **GCS is the one and only persistence layer.** There is no relational/NoSQL DB and no
   server-side local disk for data. "Where does this persist?" has exactly one answer: GCS.
   (On Cloud Run, GCS *is* the filesystem — mount nothing; auth via ADC.)
2. **Never use `localStorage` (or `sessionStorage`) as a data store.** Any data you would be
   unhappy to lose on a browser reset, or that another device/role must see, lives in GCS.
3. **i18n is hash-based and the language/translation files always live in GCS** — never in the
   repo, never bundled, never in `localStorage`. The hash registry (`hash → {en, zh, …}`) is a
   GCS object loaded at runtime (see `/team-i18n`).
4. **Identity/tokens are not "storage"** — use HTTP-only cookies / the OAuth gateway, never
   `localStorage` (see `/team-xgh-gateway`).
5. **Secrets** → Secret Manager, never GCS, never client.

## The single narrow carve-out (flagged, opt-in)
`localStorage` may hold **transient UI-only state that is not data**: which panel is open, last
route, an in-progress form draft the user wouldn't mind losing. Treat anything beyond this as a
violation. *If your project wants a literal zero-`localStorage` policy, delete this carve-out —
it is the one judgment call in this file.*

## Consequences for other commands
- **`/team-database`** reasons about GCS object layout, access patterns, and "query" shape — not
  SQL schemas/indexes. Treat folder/key design as the schema; see `/team-gcs`.
- **`/team-cache`** caches *results* in GCS (or memory), keyed per `@.claude/commands/_shared/cache-invariants.md`;
  never treat cached objects as the source of truth.
- **`/team-backup`** backs up authoritative GCS prefixes; relies on Object Versioning + lifecycle.
- **Erasure** (`/team-privacy`) must reach every GCS version, cache object, and backup — there is
  no second datastore to forget about, which is the point.

## Audit signals (violations)
- Any `localStorage.setItem` carrying user-owned data, tokens, or translations.
- A translation/language file committed to the repo or bundled into the build.
- Any persistence path that is not a GCS object write.
