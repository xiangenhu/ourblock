---
description: Install/audit the app-wide contextual "?" help assistant
argument-hint: [install | audit | wire-server | tts | analytics | tag <area>]
---

# Team Help

Implement the single floating **"?" chip + dwell/hotkey chat card** that gives users a
context-aware tour guide on every page — per the canonical spec, bound to this project's
invariants. The spec is the source of truth for design and drop-in source; this command only
fills the swap-slots the spec leaves open and adds the guardrails this app requires.

> **Canonical spec:** `@.claude/commands/_shared/CONTEXT_HELP.md` (full design, client IIFE,
> Express server, persistence contract). Follow it. If you keep the spec elsewhere in the repo
> (e.g. `docs/`), point this reference at that copy instead.

## Target: $ARGUMENTS
Options: "install" | "audit" | "wire-server" | "tts" | "analytics" | "tag <area>"

## Workflow Phases

### Phase 1: Plan (Sequential)
- **Architect**: Map the spec's four swap-slots to this app (grounding doc, app slug,
  persistence, i18n, LLM); decide route placement and which pages load the script.

### Phase 2: Client (Parallel)
- **Fullstack Developer**: Drop `contextual-help.js` into `public/`; edit the `CFG` block
  (`appSlug`, `api.*`, `langCookie`, `feedbackUrl`); tune `findMeaningfulContainer()`
  interest-selectors to this DOM. Keep the idempotent boot and single capture-phase keydown
  listener verbatim (a second listener double-fires Shift).
- **Internationalization Expert**: Wire chrome strings through **hash-based i18n**; enforce the
  **echo-of-source guard** (titles set in English source, never pre-translated); confirm
  translation/language files load from **GCS** (see `/team-i18n`).
- **UI/UX Specialist**: Verify chip + card render on public *and* authenticated pages; check the
  three role journeys (see `@.claude/commands/_shared/roles.md`).

### Phase 3: Server (Sequential)
- **Fullstack Developer**: Implement the three routes. Implement the persistence contract against
  **GCS** (not the filesystem reference impl); route `/api/help/ask` through the **unified LLM
  gateway** (never a provider directly — see `/team-content`); build `locationId`; first-turn-only
  cache + `bumpHelpStat` using **GCS CAS (`if-generation-match`)**.
- **Security Specialist**: `/api/admin/help-analytics` is **Admin-only**; the ask/tts endpoints stay
  public by design (pre-sign-in pages) but are rate-limited and input-capped per the spec.

### Phase 4: Privacy & Safety gate (Parallel)
- **Privacy Compliance Officer**: `elementSnippet`, `question`, and `locationHint` are sent to the
  LLM **and persisted in analytics**. Redact learner PII before send/cache; never store a minor's
  free-text question tied to identity (see `/team-privacy`).
- **Learning Scientist**: Help answers are learner-facing → confirm age-appropriate, tour-guide-not-
  coach framing per band (the spec's system prompt already forbids doing the user's work — see
  `/team-ai-safety`).

### Phase 5: Verify (Sequential)
- **QA Testing**: All four triggers (click; modifier-safe double-tap Shift; F1; opt-in dwell);
  2nd identical first-turn hits cache; language is in the cache key (a `zh` reader is never served
  an `en` answer); TTS `415` path for unsupported languages; **negative authz test** on the admin
  endpoint.

## Project bindings (where this app overrides the generic spec)

| Swap slot (spec §3) | Generic default | This project |
|---|---|---|
| Persistence | filesystem ref impl | **GCS only** — `cache/help:{hash}.json`, TTS under `cache/tts/`; CAS via `if-generation-match`; never `localStorage` for data; lifecycle rules on derivable cache (`/team-gcs`, storage-invariants) |
| i18n | `window.I18n` / cookie | **hash-based**, registry + language files in **GCS** (`/team-i18n`); honor the echo-of-source guard |
| LLM call | bring-your-own `callLLM` | **route through the unified LLM/content gateway** (`/team-content`) — never a provider from the help route |
| App slug | `'app'` | your `appSlug`; keep `CFG.appSlug === APP_SLUG` so `locationId` joins analytics + feedback |
| Admin analytics | unguarded | **Admin-only** (`@.claude/commands/_shared/roles.md`) |
| Grounding doc | empty | your product/design brief (in GCS); purpose questions ground in it |

## Guardrails (do not regress)
- Idempotent boot; **one** keydown listener, capture phase.
- First-turn-only caching; language is part of the key by construction.
- `localStorage` holds only transient UI state (`cx_help_enabled`, the answer cache) — never
  tokens or user data (storage-invariants).
- Cost: the cache is the lever — a hit short-circuits the LLM (`/team-cost`, `/team-cache`).

## Output Format
```
## Contextual Help Report

### Wiring
- Pages with script: [public N / authed N]  ·  CFG.appSlug == APP_SLUG: [y/n]

### Server
- Routes: /config/help-hover · /help/ask (gateway: [name]) · /admin/help-analytics (Admin-only: [y/n])
- Persistence: GCS prefix `cache/help:`  ·  CAS: if-generation-match  ·  fs ref impl removed: [y/n]

### i18n
- Chrome strings hashed: [N]  ·  echo-of-source guard: [pass/fail]  ·  registry in GCS: [y/n]

### Privacy & Safety
- Snippet PII redaction: [pass/fail]  ·  minor free-text stored: [none/▲]  ·  age-band framing: [pass/fail]

### Verify
- Triggers [click/shift/F1/dwell]: [pass]  ·  2nd-turn cache hit: [y]  ·  lang-in-key: [y]  ·  admin authz negative: [pass]

### TTS (if wired)
- 415 unsupported-language path: [y/n]  ·  GCS audio cache: [y/n]
```

## Shared references
- Canonical spec: `@.claude/commands/_shared/CONTEXT_HELP.md`
- GCS-only persistence: `@.claude/commands/_shared/storage-invariants.md`
- Roles (Admin/Educator/Learner): `@.claude/commands/_shared/roles.md`
- Cache invariants: `@.claude/commands/_shared/cache-invariants.md`
- Related commands: `/team-gcs` · `/team-i18n` · `/team-content` · `/team-privacy` · `/team-ai-safety` · `/team-cost`

- All model calls go through the single gateway (language + accounting centralized): `@.claude/commands/_shared/llm-gateway.md`

- Learning-first UX (entry jargon, focus over density, in-place LLM help, tabs/modals): `@.claude/commands/_shared/learning-ux.md`
