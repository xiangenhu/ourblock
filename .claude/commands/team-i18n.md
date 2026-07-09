---
description: Hash-based i18n audit & implementation (canonical)
argument-hint: [<files> | audit]
---

# Team i18n

Implement and audit internationalization. **The canonical pattern for these apps is
SHA-256 hash-based i18n** (below); a generic fallback for non-hash projects is at the end.

> Consolidated from the former `team-i18n` + `team-i18n-hash`. There is now one i18n
> command so the two cannot drift apart.

## Target: $ARGUMENTS
Options: specific files | "audit" for full compliance check

## Workflow Phases

### Phase 1: Audit (Parallel)
- **Internationalization Expert**: Hash compliance, untranslated strings, missing wrappers
- **Code Standards Specialist**: Inline styles (break RTL), embedded `<style>` / `<script>`

### Phase 2: Implementation (Sequential)
- **Fullstack Developer**: Wrap text, generate hashes, register translations

### Phase 3: Validation (Parallel)
- **QA Testing**: Verify translations match hashes; spot-check all supported languages
- **Cross Platform Specialist**: Test on devices and browsers
- **Accessibility Compliance Checker**: RTL layout and language accessibility

## The Hash-Based Pattern

### Hash Generation
```javascript
// Hash = SHA-256 of trimmed English text, first 16 hex chars
generateHash("Continue")        // => "31fbef162594de01"
generateHash("Welcome back!")   // => "a7c4e9..."
```
- Source language is **English**; whitespace trimmed before hashing; **case-sensitive**
- 16 hex chars (first 64 bits of SHA-256) — collision risk acceptable for human text

### Static Text Wrapping
```html
<span data-i18n="31fbef162594de01">Continue</span>
```
- Every visible text node MUST be wrapped
- **Emojis stay outside the span**: `📚 <span data-i18n="hash">Library</span>`
- No inline styles — they break RTL flipping. Use CSS classes only.

### Dynamic Text
```javascript
const wrapped = await addText("Welcome back!");
element.innerHTML = wrapped; // registers hash if new; returns <span data-i18n="...">…</span>
```
- All dynamic strings go through `addText()` (or the project's equivalent)
- Never concatenate translated fragments — translate whole phrases with placeholders

### Mandatory Script Loading (exact order, start of `<body>`)
```html
<body>
    <script src="/js/shared/i18nInit.js"></script>
    <script src="/js/shared/i18nUtils.js"></script>
    <script src="/js/i18nDynamicTranslator.js"></script>
</body>
```

### Language Detection Priority
1. URL param `?lang=zh` (also `?lng=`, `?language=`)
2. Cookie `preferredLanguage` (30-day)
3. localStorage `preferredLanguage` (backup)
4. `navigator.language`
5. Default `'en'`

### Supported Languages
- **LTR**: en, zh, es, de, fr, it, pt, ja, ko, th, vi, ru, hi
- **RTL**: ar, he, fa, ur — applied via `dir="rtl"` at document level

### Translation Storage (always GCS)
Translation/language files **always live in GCS**, never in the repo, never bundled into the
build, never in `localStorage` (see `@.claude/commands/_shared/storage-invariants.md`). The hash registry
(`hash → { en, zh, … }`) is a GCS object — canonical path `i18n/registry.json` (see `/team-gcs`) —
loaded at runtime. A language file committed to the repo is an audit violation.

## Translation Suggestion Mode (crowd-correction loop)
A teacher/admin-facing tool for correcting bad translations in place, built directly on the
hash pattern: because every string renders as `<span data-i18n="{hash}">…</span>` and that
`{hash}` is the shared key across `en.json` and every locale, any element yields all three
pieces of a correction — Original English (`translations.en[hash]`), Current translation
(`translations[lang][hash]`), and the identity to file against.

**Flow:** toggle mode → click any translated string → "Language Suggestion" modal
(English · current · editable suggestion, plus **"✨ Suggest with AI"** for LLM alternatives) →
submit → queued in GCS → admin approves in the Admin Dashboard → written to the live locale file,
**visible in real time**.

**Hard constraints (don't regress these):**
- Only active when **display language ≠ English** — there is nothing to correct in the original.
  Both the client toggle and the server reject `lang === 'en'`.
- **Approve is always admin-only** (`requireAdmin`). Submission defaults to **teacher/admin**
  (`requireTeacher`), but is env-switchable — see debugging mode below.
- Approve **writes live immediately**, reusing the on-demand-translation merge path
  (`applyTranslationToLocale` → merge one `{hash: translation}` into `locales/{lang}.json` in GCS
  → invalidate `translationCache`). No separate publish step.
- **Real-time visibility:** locale files are served `Cache-Control: no-cache` (+ Express ETag →
  cheap 304s), and approve calls the client's `reloadTranslations(lang)`. Do **not** reintroduce
  `max-age` on locale responses — it re-hides approved edits for up to 5 minutes.
- **One suggestion per string:** the id is deterministic `{lang}_{hash}`, so re-submitting the same
  string overwrites its single entry (no duplicate pile-up). Persisted as one GCS object each at
  `locales/suggestions/{id}.json` (race-free); **not** locale files, never bundled/committed.
- The tool's own chrome carries `data-suggest-ui`; the click delegator skips that subtree so the
  modal's own labels aren't themselves click-to-suggest targets.

**Debugging mode (`I18N_SUGGEST_MODE`):** `normal` (default, teacher/admin) | `debugging` (any user,
**including guests** on public/landing pages). Server swaps `requireTeacher` → `optionalAuthWithGuest`
on `/suggestions` + `/suggest-alternatives`; the client reads the public `GET /suggest-config`
(`{ mode, allowAny }`) and opens the tool accordingly. Safe because nothing goes live without admin
approval — the approval gate is the safety valve.

**Gotcha — one hash per exact English string.** "Student" and "Students" (singular/plural), or any
phrasing variant, are **separate hashes** even if they share a translation. Correcting one does not
change the others — the classic "approved but still shows the old word" is usually a *different* hash
on the visible element. When a term recurs, expect to correct each variant.

**Key files (this app):** `client/src/i18n/SuggestionMode.jsx` (+ `.css`, mounted once in `App.jsx`),
`api.{submit,get,approve,reject}TranslationSuggestion` + `suggestTranslationAlternatives` +
`getTranslationSuggestConfig` (`client/src/utils/api.js`), `TranslationsTab` in
`client/src/pages/AdminDashboard.jsx`, and the `/suggestions*`, `/suggest-alternatives`,
`/suggest-config` routes + `applyTranslationToLocale` in `server/routes/i18n.js`.
Requires GCS configured; AI button needs an LLM provider; endpoints 503 otherwise.

### Installable runtime (transfer to another of our apps)
The **whole** hash-based i18n system — client runtime, server routes, on-demand translation, and
Suggestion Mode — is packaged as a self-contained, installable kit for our stack
(Node.js + Express + GCS + React):

> **Kit:** `@.claude/commands/_shared/i18n-kit/` — `README.md` (complete document + integration
> contract), `install.mjs` (copies the runtime, prints wiring), and `runtime/` (the actual code).
>
> ```bash
> node .claude/commands/_shared/i18n-kit/install.mjs --admin-tab
> ```
>
> The kit's `README.md` is the canonical, portable spec (mirrors how `team-help.md` points at
> `_shared/CONTEXT_HELP.md`). A sibling app injects only what varies — its **GCS storage service**,
> **auth middleware** (`requireTeacher`/`requireAdmin`), and **LLM translate fn** — into one factory,
> `createI18nRouter({...})`. Everything above (hash pattern, invariants) holds unchanged.

## Common Violations
- ❌ Hardcoded text in JSX/templates (most common)
- ❌ String concatenation `"Hello, " + name` — translate the whole phrase with a placeholder
- ❌ Inline `style="…"` — breaks RTL mirroring
- ❌ Emoji inside `<span data-i18n>` — wraps the emoji as translatable
- ❌ Script loading out of order — `i18nInit.js` must be first
- ❌ Hash that doesn't match the English source — silent translation failure
- ❌ Dynamic content via raw `innerHTML` without `addText()`

## Audit Checklist
**HTML** — three scripts in order; all text wrapped; hashes match (case + whitespace);
emojis outside spans; no inline styles.
**JavaScript** — dynamic text via `addText()`; no `innerHTML = "raw text"`; hash registration present.
**CSS** — no hardcoded text in pseudo-elements; logical properties (`margin-inline-start`).
**Assets** — fonts support target scripts (CJK, Arabic); images-with-text have language alternates.

## Generic Fallback (non-hash projects only)
If a project does **not** use the hash registry, hold the same invariants with a key-based library:
- All user-facing text routes through a translation layer (no hardcoded display strings)
- Pluralization and date/number formatting use a locale-aware library (`Intl`, ICU)
- Locale selection is persisted and survives reload
- Same RTL and font-coverage rules as above

## Output Format
```
## i18n Compliance Report

### Summary
- Files audited: [count]  ·  Compliance score: [%]  ·  Issues: [count] (auto-fixable: [count])

### Issues by Severity
#### Critical (Breaks i18n)
- [file:line] — [issue] — [fix]
#### Warning (Should Fix)
- [file:line] Text: "[text]" — Add: `<span data-i18n="[hash]">[text]</span>`
#### Info (Best Practice)
- [file:line] — [item]

### New Hashes to Register
| Hash | English Text |
|------|--------------|

### RTL Testing Required
- [file/page] — [reason]
```
