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
