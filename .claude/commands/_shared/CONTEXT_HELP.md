# Contextual Help — a portable design for an app-wide "?" assistant

This document specifies a **single floating "?" chip + dwell/hotkey chat card** that gives users a context-aware AI tour guide for any web app. The pattern is one self-contained client module plus three small server endpoints (optionally four with text-to-speech). There is no build step, no framework dependency, no design system to adopt.

This is the full reference: design spec, swap-slot table, and complete drop-in source for both the client and the server. The goal is that a skill can drop the files in, replace a handful of constants, implement the server routes against whatever LLM/store the host app uses, and the whole feature works.

---

## 1. What the user gets

A subtle button in the bottom-right corner of every page. On demand, it opens a small draggable chat card pre-loaded with the user's current context:

```
┌──────────────────────────────────────────────┐
│                                                │
│              (the rest of the app)             │
│                                          ┌──┐  │
│                                          │ ?│  │  ← chip (always present)
│                                          └──┘  │
└──────────────────────────────────────────────┘
```

Four ways to open the card (all converge on the same UI, primed with the same context):

| Trigger             | Behaviour                                                                                                       |
|---------------------|-----------------------------------------------------------------------------------------------------------------|
| **Click the chip**  | Opens the card in the corner. Manual: no auto-first question.                                                   |
| **Double-tap Shift**| Opens the card at the cursor / focused element with an automatic first question (*"What is this, and what can I do here?"*). Solo Shift only — using Shift as a modifier (`Shift+A`, `Shift+Tab`) does **not** trigger it. |
| **F1**              | Same as double-tap Shift, kept as a secondary fallback for browsers that deliver F1 to the page.                |
| **Cursor dwell**    | Opt-in. When the user enables it via the toggle inside the card header, pausing the cursor on a meaningful element for `dwellMs` (default 3000 ms) opens the card with an auto-first question. **OFF by default** so nobody is ambushed. |

The card itself contains:

1. A **Context** chip showing what the answer is grounded in (nearest heading + view name).
2. Three **quick-ask** buttons: *What is this?* / *What can I do here?* / *Why is this here?*.
3. A free-form question input (Enter sends; multi-turn follow-ups supported).
4. A **Read aloud** speaker chip on every completed reply (optional — requires the TTS endpoint).
5. A **Feedback** button (optional — launches an external feedback wizard with a pre-filled `sourceID`).
6. Maximize / drag handles, a footer.

---

## 2. Architecture

```
Browser                                                  Server
─────────────────────────────                          ─────────────────────────────
contextual-help.js (single IIFE, no deps)              GET  /api/config/help-hover
  ├─ chip + card DOM (idempotent boot)                   └─ { dwellMs, enabled }
  ├─ injected styles
  ├─ dwell + double-tap-Shift + F1 detector            POST /api/help/ask
  ├─ DOM context extractor (snippet+heading+view)        ├─ validates + clamps inputs
  ├─ markdown renderer for bot replies                   ├─ builds locationId
  ├─ FNV-1a hash → localStorage answer cache             ├─ system = framing + grounding doc
  ├─ optional i18n integration                           ├─ first-turn cache lookup
  ├─ optional feedback wizard launcher                   ├─ call LLM (provider-agnostic)
  └─ optional per-turn TTS player                        └─ bumpHelpStat (CAS-safe)

                                                       POST /api/tts             (optional)
                                                         ├─ language-coverage guard (415)
                                                         ├─ cache key = sha1(model,voice,
                                                         │             lang,instr,text)
                                                         └─ on miss → upstream, persist

                                                       GET  /api/admin/help-analytics
                                                         ├─ scan help: prefix
                                                         └─ group by locationId, rank
```

The client never talks to the LLM provider directly. All routing goes through `POST /api/help/ask`, so the consuming app keeps full control of provider choice, prompt composition, validation caps, and usage accounting.

---

## 3. Swap slots — the customization surface

Before lifting the module, identify these slots in your target app. Everything else is generic.

| Slot                       | Default                                                  | What you customize it with                                                                                                                          |
|----------------------------|----------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Grounding doc**          | Empty (UI-only help)                                     | Any markdown that anchors *why* questions. Could be a product brief, design principles, user manual, or empty for pure UI help.                       |
| **App slug**               | `'app'`                                                  | Short identifier used as the prefix in `locationId` strings like `{appSlug}:{pathKey}:{locationKey}` so analytics + feedback streams can be joined.   |
| **i18n integration**       | Reads `window.I18n` if present                           | Optional. Module falls back to a configurable cookie / English-only behaviour.                                                                        |
| **TTS endpoint**           | Disabled                                                 | Optional. Wire `POST /api/tts` to any TTS provider and Read-aloud chips appear on completed replies.                                                  |
| **Feedback launcher**      | Hidden                                                   | Optional. Set `CFG.feedbackUrl` to launch an external wizard with `sourceID` pre-filled.                                                              |
| **Persistence backend**    | File system reference impl below                         | Any KV store with read-modify-write. Pattern works on GCS, S3, Firestore, Redis, Postgres-JSON.                                                       |
| **Visual style**           | Neutral gold/serif palette                               | Inline CSS in the module is fully self-contained. Edit the `injectStyles()` block or layer a stylesheet on top — class names are stable.              |
| **Footer copy**            | *"AI offers · adapt, edit, or ignore"*                  | Any one-line stance. Marked with `data-i18n` so it auto-translates.                                                                                   |
| **Hotkey**                 | Double-tap Shift + F1                                    | Swap `DOUBLE_TAP_WINDOW_MS` / `HOTKEY` constants. The "modifier-aware reset" logic is what makes any modifier-key double-tap safe.                       |

---

## 4. Client module — design notes

### 4.1 Idempotent boot, self-contained styles

The module is wrapped in `if (window.__contextualHelpInstalled) return;` so multiple `<script>` tags can't double-install it. It calls `injectStyles()` to write its own `<style>` into the document head — meaning it works on any HTML page regardless of which stylesheet is loaded.

### 4.2 DOM context extraction

When the card opens, three pieces of context are captured from wherever the cursor was last seen:

```js
function elementSnippet(el) {
  // 1. Walk up ≤ 8 hops to find a "meaningful container" — defined as:
  //    - matches an interest selector ([data-help], dialog, .card, button, a,
  //      label, form-row, .nav-item, etc.) — APP-SPECIFIC LIST, edit freely
  //    - OR has ≥ 20 chars of visible text
  // 2. Clone it; strip <script>, <style>, <svg>, and the help UI itself.
  // 3. Collapse whitespace; cap at SNIPPET_MAX_CHARS (1500).
}

function nearestHeadingFor(el) {
  // Walk up ≤ 12 hops looking for h1–h4 or .section-title / .modal-title /
  // .topbar-title / .task-name. Cap at 200 chars. Fall back to document.title.
}

function currentViewName() {
  // Read .nav-item.active text or #topbar-title for SPAs; '' elsewhere.
}
```

The snippet is the LLM's authoritative source of *"what is on screen"*. The server-side system prompt explicitly forbids inventing UI not present in the snippet.

### 4.3 Stable element identity — `locationKeyFor()`

For analytics and feedback joining, every hovered element is reduced to a stable, human-readable key. Walk up to 10 hops, in priority order:

1. `data-help="…"` — author-assigned label (highest priority — set this on UI you want to track explicitly)
2. `id="…"` — stable DOM id
3. `data-view` / `data-task` — SPA routing attrs
4. Nearest heading text (slugified)
5. `tag.first-class` — last resort

The key is composed into `{appSlug}:{pathKey}:{locationKey}` — a single string used as a `sourceID` for both help analytics and any external feedback system. The same UI element produces the same id no matter which session, which user, or which language.

**The most actionable thing you can do as an app author** is sprinkle `data-help="some-label"` onto elements you want unambiguous analytics for. Then the id stays stable even when the DOM is refactored.

### 4.4 Trigger detection — the modifier-aware double-tap

The conflict-free hotkey is the key UX insight worth lifting verbatim:

```js
const DOUBLE_TAP_WINDOW_MS = 400;
let lastShiftDownAt = 0;
let shiftSequenceBroken = false;

function onKey(e) {
  // 1. Solo Shift — primary, conflict-free
  if (e.key === 'Shift' && !e.repeat) {            // e.repeat filters OS autorepeat
    const now = Date.now();
    if (!shiftSequenceBroken && lastShiftDownAt &&
        (now - lastShiftDownAt) < DOUBLE_TAP_WINDOW_MS) {
      openHelpAtCursor();
      lastShiftDownAt = 0;
      return;
    }
    lastShiftDownAt = now;
    shiftSequenceBroken = false;
    return;
  }

  // 2. Any OTHER key during the window resets — Shift was a modifier, not a tap
  if (lastShiftDownAt && e.key !== 'Shift') shiftSequenceBroken = true;

  // 3. F1 secondary fallback (some browsers swallow it; harmless when they do)
  if (e.key === 'F1' || e.code === 'F1') openHelpAtCursor();
}

document.addEventListener('keydown', onKey, true);  // capture phase, ONE listener only
```

**Why this works:** `e.repeat` filters out OS auto-repeat when Shift is held. The "sequence broken" flag is what makes the hotkey safe — using Shift as a modifier (`Shift+Tab`, `Shift+A`, etc.) does not register as the second tap of a pair. The keydown listener is attached to `document` in capture phase, **exactly once**. A second listener on `window` would see the same event twice and make a single Shift press look like a double-tap.

**Dwell detection** uses a re-armable `setTimeout` keyed off `mousemove`, with a 6-pixel movement threshold to debounce minor shake. It is gated on `state.autoOpenEnabled && state.userEnabled` (both off by default), and ignores cursor motion over `<input>`, `<textarea>`, `[contenteditable]`, open `<select>`s, and the help UI itself.

### 4.5 Two-tier caching

**Client (localStorage)** — keyed by FNV-1a 32-bit hash of `(question + snippet + heading + view + lang)`. Capped at 80 entries with 7-day TTL. Pruning sorts by recency, keeps the freshest. Only the **first assistant turn** of a session is cached; follow-ups depend on conversation state and aren't deterministic on context alone. On a hit the answer is served immediately, the recency timestamp is refreshed, and a `cached: true` flag is tagged on the message.

**Server (object store)** — `cache/help:{hash}.json` keyed by `shortHash(system + '' + userPrompt)`. Because the system prompt is built from the language name and the user prompt encodes the snippet/heading/view/page/question, the key inherently encodes language — there is **no path** by which a non-English reader could be served an English answer. Same first-turn-only rule. Cache TTL is 7 days. Hits short-circuit the LLM call entirely and respond in ~150–200 ms.

> **Hashing function.** FNV-1a 32-bit → base36 gives ~7-char keys with ~1e-5 collision probability at 1k distinct keys. The client and server use the same algorithm so cache shapes line up if you ever want to cross-warm.

### 4.6 Markdown rendering for bot replies

LLM replies are passed through a tiny in-house markdown renderer before injection:

1. Escape all HTML first (prevents any raw HTML from the LLM from executing).
2. Extract fenced ``` `` ` `` code blocks to placeholder tokens before the inline pass — so backticks inside `*…*` patterns can't be re-interpreted.
3. Reintroduce only the formatting tags **we generate ourselves**: `<p>`, `<h4–6>`, `<ul>`, `<ol>`, `<blockquote>`, `<strong>`, `<em>`, `<code>`, `<pre>`, `<a target="_blank" rel="noopener noreferrer">`.

Headings (`#`, `##`, `###`) intentionally render at modest levels (`h4`, `h5`, `h6`) so they don't dominate the small card.

### 4.7 Per-turn read-aloud (optional)

Every **completed** bot reply gets its own Read-aloud chip below the bubble. The still-streaming "Thinking…" placeholder deliberately gets no chip. Implementation invariants:

- **One audio stream at a time.** Clicking a different turn's chip stops the current one and starts the new one. Clicking the same chip while playing stops it. Clicking while loading is ignored (swallows spam-clicks). State is held in a single `speak` object (`{ audio, activeTurn, state }`) so a re-render of the messages pane repaints the play/stop icon on the right turn.
- **`prepareTurnTextForTts()`** strips markdown syntax (fences, asterisks, underscores, headings, blockquote markers, links) before sending — so the voice reads natural prose, not *"asterisk asterisk bold asterisk asterisk"*. Capped at 2500 chars.
- **Language coverage gate.** `ttsSupportedHere()` reads a per-language `tts: true/false` flag from i18n metadata and hides the chip entirely for languages without voice coverage. Better than failing silently after a click.
- **Language change mid-session** stops any playing audio (its language no longer matches the new UI), re-translates the chip's `title` attribute, and re-renders the messages pane.

If you don't wire `/api/tts`, the chip never appears (no further configuration needed).

### 4.8 Echo-of-source guard (i18n-related)

A subtle bug that bites hash-based dynamic i18n systems: the `<button title="…">` text on the chip is set to the **English source string**, never `t(...)`. If your i18n module captures `data-i18n-src-title` on first paint, writing a translated title up front would store the translated text as the "source", and the next language switch would ask the translator to translate Chinese → Chinese — which trips a guard rail and produces broken output.

Always set titles in source language; let the i18n sweep translate them on render.

---

## 5. Server endpoints

### 5.1 `GET /api/config/help-hover` — public

```json
{ "dwellMs": 3000, "enabled": true }
```

Setting `dwellMs` to `0` disables the auto-open path globally regardless of the per-user toggle. The floating chip continues to work as a manual trigger.

### 5.2 `POST /api/help/ask` — public

**Request:**
```json
{
  "question": "What is this?",
  "elementSnippet": "…(text content of the hovered container, ≤ 2000 chars)…",
  "nearestHeading": "Workspace",
  "viewName": "Phase 1",
  "pageTitle": "App",
  "locationKey": "id:phase-1-task-2",
  "pathKey": "/portal",
  "lang": "en",
  "history": [
    { "role": "user", "content": "…" },
    { "role": "assistant", "content": "…" }
  ]
}
```

**Validation caps** (reject with `400` on overflow):

| Field         | Max chars / items |
|---------------|-------------------|
| question      | 800               |
| elementSnippet| 2000              |
| nearestHeading| 200               |
| viewName      | 80                |
| pageTitle     | 200               |
| locationKey   | 120               |
| pathKey       | 200               |
| history       | 8 turns × 1200 chars each |

**System prompt** is composed from:

1. A *"you are the contextual help assistant"* framing block — explicitly **a tour guide, not a coach/reviewer/evaluator**, with rules:
   - 2–5 sentences default. Plain language.
   - Light markdown rendered (**bold** for key terms, `inline code` for exact UI labels).
   - The DOM snippet is **authoritative** for what is actually on screen. Describe buttons / fields / sections using the words that appear there. Never invent UI not present.
   - If the snippet is a form input, tell them what to type and why it matters. If a button, what happens when they click it. If a tile, what the task is and the smallest useful next step.
   - When the question is about the **purpose** of a feature, ground the answer in the grounding doc.
   - Respond in the requested language. Do not switch languages mid-answer.
2. The full grounding markdown (cached on the server). If you have no grounding doc, omit this block and answer purely from the snippet.

**User prompt** assembles `Page · View · Heading · Snippet · Prior turns · Question`. If the question is empty (auto-first-turn from dwell or hotkey), the prompt instructs the model to open with one sentence describing what this is and one sentence with the smallest useful next action.

**Response:**
```json
{ "answer": "Light **markdown** is supported.", "cached": false }
```

**`locationId` shape** — built server-side as `{appSlug}:{pathKey}:{locationKey || 'loc:unknown'}` and stored on the cache entry's `analytics.locationId` so the admin endpoint can aggregate by it.

### 5.3 `POST /api/tts` — public (optional)

Validation: text ≤ 2500 chars, instructions ≤ 500.

**Cache key:** `sha1(model + '' + voice + '' + lang + '' + effectiveInstructions + '' + text).slice(0, 40)`.

**Layout:**
```
cache/tts/{key}.mp3   ← raw audio bytes
cache/tts/{key}.json  ← {key, model, voice, lang, instructions, text, bytes, createdAt}
```

Return `415` (Unsupported Media Type) when the requested language has no voice coverage, with `{ error: "tts not supported for this language", lang }`. This lets the client trust `meta.tts === false` and hide the button without burning a cache miss + an upstream call only to fail.

### 5.4 `GET /api/admin/help-analytics` — admin-only

Query params: `?group=location` (default) or `?group=none`, `?limit=500` (max 2000).

**Response shape (`group=location`):**
```json
{
  "totalHashes": 184,
  "totalAsks": 6293,
  "totalHits": 5471,
  "locations": [
    {
      "locationId": "{appSlug}:/portal:id:phase-1-task-2",
      "pathKey": "/portal",
      "locationKey": "id:phase-1-task-2",
      "viewName": "Phase 1",
      "nearestHeading": "Workspace",
      "askCount": 47,
      "hitCount": 41,
      "hashCount": 3,
      "langs": { "en": 22, "zh": 25 },
      "topQuestions": [
        { "q": "What is this?", "count": 18 },
        { "q": "Why is this here?", "count": 12 }
      ],
      "sampleAnswer": "…first 400 chars of the most-asked answer…",
      "firstAskedAt": 1745098234123,
      "lastAskedAt": 1745301992884
    }
  ]
}
```

Because `locationId` is a single string, the admin tooling can join two streams instantly: *"this button gets asked about a lot AND has 3 critical feedback items — fix the affordance."*

---

## 6. Frequency analytics — the bump pattern

Every help ask — hit OR miss — calls `bumpHelpStat(cacheKey, ...)`, which **CAS-mutates** the cache doc to bump `askCount` and (on hits) `hitCount`. The doc shape:

```json
{
  "answer": "…(cached LLM response)…",
  "lang": "zh",
  "analytics": {
    "locationId": "{appSlug}:/portal:id:phase-1-task-2",
    "locationKey": "id:phase-1-task-2",
    "pathKey": "/portal",
    "nearestHeading": "Workspace",
    "viewName": "Phase 1",
    "pageTitle": "App",
    "locationHint": "…first 160 chars of snippet…",
    "question": "What is this?",
    "lang": "zh"
  },
  "askCount": 47,
  "hitCount": 41,
  "createdAtMs": 1745098234123,
  "updatedAtMs": 1745301992884,
  "updatedAt": "2026-04-22T08:46:32.884Z"
}
```

**Why CAS matters.** Multiple users can ask about the same button concurrently. Read-modify-write with optimistic generation matching (retry on conflict, ~5 attempts) ensures no count is lost. The pattern works with GCS object generation, Firestore transactions, Redis `WATCH`/`MULTI`, or any KV store that exposes a CAS primitive.

---

## 7. Multilingual end-to-end (optional)

The help facility is the most language-sensitive path in most apps because every input and output crosses an i18n boundary:

| Surface                                | Translation mechanism                                                                                                |
|----------------------------------------|----------------------------------------------------------------------------------------------------------------------|
| UI chrome (chip title, card title, quick-asks, send button, footer) | `data-i18n` attributes → your i18n system                                                                            |
| LLM answer                             | The system prompt's `Respond in {langName}. Do not switch languages mid-answer.` line is rebuilt per request from the cookie / header / query param. |
| Spoken audio                           | Multilingual voice picks pronunciation from the text. Per-language steering hints can drive accent (e.g. Mandarin vs Cantonese). |
| Cache namespace                        | Hash of `(system + user)` already encodes `langName` — a Chinese reader cannot be served an English cached answer.   |

If you skip i18n, the module reads `window.I18n?.lang ?? 'en'` and defaults to English-only behaviour with no further wiring.

---

## 8. Drop-in checklist

1. **Copy `contextual-help.js`** (Section 10 below) into your `public/` folder. Edit the `CFG` block at the top:
   - `appSlug` — replaces `'app'` in `locationId`.
   - `api.*` — paths to your server endpoints if not the defaults.
   - `langCookie` — name of your locale cookie.
   - `feedbackUrl` — optional. Omit / `null` to hide the Feedback button.
2. (Optional) Tune `findMeaningfulContainer()`'s interest-selector list to match your DOM (modal class names, nav classes, form-row classes, etc.).
3. **Add one `<script src="/contextual-help.js?v=…"></script>` per page** (public and authenticated). Idempotent boot means duplicate tags are safe.
4. **Implement the server endpoints** from Section 11 below:
   - `GET /api/config/help-hover` — return `{ dwellMs, enabled }` from a config var.
   - `POST /api/help/ask` — validate caps, build the `locationId`, compose the system prompt with your **grounding doc**, check the cache, call your LLM dispatcher, persist via `bumpHelpStat`.
   - `GET /api/admin/help-analytics` — list `cache/help:` entries, aggregate by `locationId`.
5. **Optional: `POST /api/tts`** with a per-language coverage gate (`415` for unsupported), `sha1` cache key, and fire-and-forget persist after responding.
6. **Optional: feedback wizard URL** in `CFG.feedbackUrl` — or leave undefined to hide the Feedback button entirely.
7. **Sprinkle `data-help="…"`** on UI elements you want stable analytics for. Especially: nav items, primary buttons, form sections, modal dialogs. These keys become the `locationKey` portion of the `locationId` and remain stable across DOM refactors.

---

## 9. Why this design holds together

- **One module, every page, no build step.** Pure ES5-ish IIFE, injects its own CSS, idempotent. Adding it to a new page is one `<script>` tag. Works on standalone pre-sign-in pages because the endpoints are public by design.
- **Context that's actually useful.** Hovering the same word in two places gives two different answers because `elementSnippet` reads the live container, not the URL. Hovering a button tells you what clicking it does; hovering a tile tells you what the task is.
- **Caching that doesn't lie.** Two-tier (localStorage + object store) with the same hash strategy at both layers; only first turns cached so follow-ups stay correct; language is part of the key by construction; a `cached: true` badge surfaces the path so users know what they're reading came from the warm cache.
- **Analytics that join.** `locationId` is a single string shaped to match whatever feedback / telemetry system already uses a `sourceID`. No schema change needed to correlate.
- **Hotkeys that don't fight other hotkeys.** Double-tap Shift is conflict-free with everything (Shift-as-modifier resets the sequence). F1 kept as a fallback. Auto-dwell is opt-in so nobody is ambushed.
- **TTS that respects cost and language reality.** Cache hits are free and ~10× faster; languages without voice coverage hide the chip rather than failing; per-language steering hints make multilingual voice usable.
- **Stance-aligned framing.** The system prompt forbids the help bot from doing the user's work for them. It's a tour guide, not a worker. The footer sets that expectation the first time anyone opens the card.

---

## 10. Reference client — `public/contextual-help.js`

Drop-in client module. Configure the `CFG` block at the top, otherwise lift verbatim. Pure ES5-ish IIFE, no dependencies.

```js
/* contextual-help.js — app-wide context-sensitive "?" assistant.
 *
 * One-file IIFE. Idempotent. Injects its own styles. Works on any HTML page.
 * Three triggers: click the chip, double-tap Shift, F1 — plus opt-in dwell.
 * The card sends the DOM snippet under the cursor to /api/help/ask and renders
 * the LLM's reply with light markdown. Optional per-turn TTS + feedback launcher.
 */
(function () {
  'use strict';

  if (window.__contextualHelpInstalled) return;
  window.__contextualHelpInstalled = true;

  // ─── Configuration ──────────────────────────────────────────────────────
  // Edit these constants to wire the module to your app.
  const CFG = {
    appSlug: 'app',                          // namespace for locationId
    langCookie: 'lang',                      // cookie holding the UI language code
    api: {
      config:     '/api/config/help-hover',  // dwell ms + auto-open flag
      ask:        '/api/help/ask',           // main Q&A endpoint
      tts:        '/api/tts',                // optional read-aloud
      languages:  '/api/i18n/languages',     // optional — drives tts coverage gate
    },
    feedbackUrl: null,                       // e.g. 'https://your-wizard.example/' or null to hide
    footerText:  'AI offers · adapt, edit, or ignore',
  };

  // ─── Self-contained CSS ─────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('cx-help-styles')) return;
    const css = `
#cx-help-chip{position:fixed;right:18px;bottom:18px;z-index:2147483000;
  width:42px;height:42px;border-radius:50%;
  background:radial-gradient(circle at 32% 28%,#f4dc8d 0%,#c9a84c 55%,#a68632 100%);
  color:#2b1d05;border:none;cursor:pointer;
  font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:21px;line-height:1;
  box-shadow:0 6px 18px rgba(0,0,0,.55),0 2px 4px rgba(0,0,0,.4),
    inset 0 1px 0 rgba(255,255,255,.45),0 0 0 1px rgba(201,168,76,.4);
  display:flex;align-items:center;justify-content:center;
  transition:transform .15s ease,box-shadow .15s ease;opacity:.92;}
#cx-help-chip:hover{opacity:1;transform:translateY(-2px) scale(1.06);}
#cx-help-chip span{pointer-events:none;text-shadow:0 1px 0 rgba(255,255,255,.35);}

#cx-help-card{position:fixed;z-index:2147483001;
  width:min(400px,calc(100vw - 32px));max-height:min(500px,calc(100vh - 32px));
  color:#1d2838;
  background:linear-gradient(180deg,rgba(255,255,255,.96) 0%,rgba(247,244,236,.94) 100%),#fbf8ef;
  border:1px solid rgba(130,100,40,.35);border-radius:14px;
  box-shadow:0 28px 60px rgba(8,14,28,.55),0 12px 24px rgba(8,14,28,.4),
    0 2px 6px rgba(8,14,28,.3),inset 0 1px 0 rgba(255,255,255,.9),
    inset 0 -1px 0 rgba(120,90,30,.08),0 0 0 1px rgba(0,0,0,.18);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  display:flex;flex-direction:column;
  font-family:'DM Sans',system-ui,sans-serif;font-size:12.5px;line-height:1.55;
  opacity:0;visibility:hidden;
  transform:translateY(10px) scale(.82);transform-origin:center center;
  transition:opacity .28s cubic-bezier(.4,0,.2,1),
             transform .42s cubic-bezier(.22,1.18,.36,1),
             visibility 0s linear .42s;
  pointer-events:none;overflow:hidden;}
#cx-help-card.open{opacity:1;visibility:visible;transform:translateY(0) scale(1);pointer-events:auto;
  transition:opacity .28s cubic-bezier(.4,0,.2,1),
             transform .42s cubic-bezier(.22,1.18,.36,1),
             visibility 0s linear 0s;}
#cx-help-card.dragging{transition:none;cursor:grabbing;user-select:none;}
#cx-help-card.maximized{left:16px !important;top:16px !important;right:16px;bottom:16px;
  width:auto;max-height:none;height:calc(100vh - 32px);max-width:none;}

#cx-help-card .cxh-head{display:flex;align-items:center;gap:10px;padding:11px 12px;
  background:linear-gradient(180deg,#c9a84c 0%,#b89638 100%);
  color:#231708;cursor:grab;user-select:none;
  border-bottom:1px solid rgba(130,100,40,.45);}
#cx-help-card .cxh-title{flex:1;display:flex;align-items:center;gap:8px;
  font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:14px;}
#cx-help-card .cxh-dot{width:9px;height:9px;border-radius:50%;
  background:radial-gradient(circle at 30% 30%,#fff6d8,#7a5c1f);}
#cx-help-card .cxh-head-actions{display:flex;gap:6px;align-items:center;}
#cx-help-card .cxh-toggle{background:rgba(255,255,255,.2);border:1px solid rgba(0,0,0,.2);color:#231708;
  font-size:10px;letter-spacing:.04em;padding:3px 8px;border-radius:10px;cursor:pointer;
  font-family:'IBM Plex Mono',monospace;}
#cx-help-card .cxh-toggle.on{background:rgba(255,255,255,.55);}
#cx-help-card .cxh-fb{display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.4);
  border:1px solid rgba(0,0,0,.22);color:#231708;font-size:11px;font-weight:600;
  padding:3px 9px 3px 7px;border-radius:11px;cursor:pointer;}
#cx-help-card .cxh-max,#cx-help-card .cxh-close{background:rgba(255,255,255,.18);
  border:1px solid rgba(0,0,0,.18);color:#231708;width:24px;height:22px;padding:0;border-radius:6px;
  font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
#cx-help-card .cxh-close{font-size:18px;}

#cx-help-card .cxh-tts-row{display:flex;justify-content:flex-end;margin-top:6px;padding-top:6px;
  border-top:1px dashed rgba(130,100,40,.22);}
#cx-help-card .cxh-tts{display:inline-flex;align-items:center;gap:5px;background:#faf3dd;
  border:1px solid rgba(130,100,40,.3);color:#6b4b10;padding:3px 8px;border-radius:11px;
  font-family:'IBM Plex Mono',Menlo,monospace;font-size:9.5px;letter-spacing:.08em;
  text-transform:uppercase;cursor:pointer;line-height:1;}
#cx-help-card .cxh-tts.is-playing{background:#fff;border-color:#8a6f32;color:#3a2f15;}
#cx-help-card .cxh-tts.is-busy{cursor:wait;opacity:.75;}
#cx-help-card .cxh-tts.is-error{background:#fdecec;border-color:#c96d6d;color:#7a1f1f;}
#cx-help-card .cxh-tts-spin{display:inline-block;width:10px;height:10px;
  border:2px solid currentColor;border-top-color:transparent;border-radius:50%;
  animation:cxhSpin .7s linear infinite;}
@keyframes cxhSpin{to{transform:rotate(360deg);}}

#cx-help-card .cxh-context{padding:7px 12px;border-bottom:1px solid rgba(130,100,40,.2);
  font-size:10.5px;color:#6b5c3f;background:#f4ecd5;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#cx-help-card .cxh-context-label{font-family:'IBM Plex Mono',monospace;font-size:9px;
  letter-spacing:.12em;text-transform:uppercase;color:#8a7549;margin-right:4px;}
#cx-help-card .cxh-context-val{color:#3a2f15;font-weight:500;}

#cx-help-card .cxh-msgs{flex:1;min-height:90px;max-height:280px;overflow-y:auto;padding:12px;
  display:flex;flex-direction:column;gap:9px;
  background:linear-gradient(180deg,#fbf8ef 0%,#f5efdc 100%);}
#cx-help-card.maximized .cxh-msgs{max-height:none;}
#cx-help-card .cxh-empty{color:#7a6a4a;font-size:11.5px;padding:10px 4px;line-height:1.5;}
#cx-help-card .cxh-msg{max-width:90%;padding:8px 11px;border-radius:10px;font-size:12.5px;
  line-height:1.55;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px 2px rgba(0,0,0,.08);}
#cx-help-card .cxh-msg.user{align-self:flex-end;
  background:linear-gradient(180deg,#e8c97a,#c9a84c);color:#231708;
  border:1px solid rgba(130,100,40,.35);}
#cx-help-card .cxh-msg.bot{align-self:flex-start;background:#fff;color:#1d2838;
  border:1px solid rgba(130,100,40,.18);}
#cx-help-card .cxh-msg.bot.loading{opacity:.7;font-style:italic;}
#cx-help-card .cxh-msg.bot .cxh-p{margin:0 0 8px 0;}
#cx-help-card .cxh-msg.bot .cxh-p:last-child{margin-bottom:0;}
#cx-help-card .cxh-msg.bot .cxh-h{font-family:'Playfair Display',Georgia,serif;
  margin:2px 0 6px 0;color:#231708;line-height:1.3;font-weight:700;}
#cx-help-card .cxh-msg.bot h4.cxh-h{font-size:14px;}
#cx-help-card .cxh-msg.bot h5.cxh-h{font-size:13px;}
#cx-help-card .cxh-msg.bot h6.cxh-h{font-size:12px;letter-spacing:.02em;
  text-transform:uppercase;color:#6b5c3f;}
#cx-help-card .cxh-msg.bot .cxh-ul,#cx-help-card .cxh-msg.bot .cxh-ol{margin:0 0 8px 0;padding-left:20px;}
#cx-help-card .cxh-msg.bot .cxh-bq{margin:2px 0 8px 0;padding:6px 10px;
  border-left:3px solid #c9a84c;background:#faf3dd;color:#4a3d1d;
  border-radius:0 4px 4px 0;font-style:italic;}
#cx-help-card .cxh-msg.bot strong{color:#231708;font-weight:700;}
#cx-help-card .cxh-msg.bot a{color:#8a6f32;text-decoration:underline;text-underline-offset:2px;}
#cx-help-card .cxh-msg.bot .cxh-ic{font-family:'IBM Plex Mono',Menlo,monospace;font-size:11.5px;
  background:#f4ecd5;border:1px solid rgba(130,100,40,.25);padding:1px 5px;border-radius:3px;color:#3a2f15;}
#cx-help-card .cxh-msg.bot .cxh-code{margin:2px 0 8px 0;padding:8px 10px;
  background:#1d2838;color:#e8e0c5;border-radius:6px;
  font-family:'IBM Plex Mono',Menlo,monospace;font-size:11.5px;overflow-x:auto;line-height:1.5;}

#cx-help-card .cxh-quickrow{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 0;background:#f5efdc;}
#cx-help-card .cxh-quick{background:#fff;border:1px solid rgba(130,100,40,.3);color:#3a2f15;
  font-size:11px;padding:5px 10px;border-radius:14px;cursor:pointer;font-family:inherit;}
#cx-help-card .cxh-quick:hover{border-color:#8a6f32;color:#231708;background:#fffbef;}

#cx-help-card .cxh-inputrow{display:flex;gap:6px;padding:10px 12px 8px;background:#f5efdc;
  border-top:1px solid rgba(130,100,40,.2);margin-top:10px;}
#cx-help-card .cxh-input{flex:1;background:#fff;color:#1d2838;
  border:1px solid rgba(130,100,40,.3);border-radius:6px;padding:7px 10px;
  font-family:inherit;font-size:12px;outline:none;}
#cx-help-card .cxh-input:focus{border-color:#8a6f32;box-shadow:0 0 0 2px rgba(201,168,76,.25);}
#cx-help-card .cxh-send{background:linear-gradient(180deg,#d4b45c,#b89638);color:#231708;
  border:1px solid rgba(130,100,40,.5);border-radius:6px;padding:7px 14px;
  font-family:inherit;font-weight:600;font-size:11.5px;cursor:pointer;}

#cx-help-card .cxh-foot{padding:7px 12px 10px;font-family:'IBM Plex Mono',monospace;
  font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#8a7549;
  text-align:center;background:#f5efdc;}

@media (max-width:520px){
  #cx-help-card:not(.maximized){left:8px !important;right:8px;top:auto !important;
    bottom:70px;width:auto;max-height:70vh;}
  #cx-help-chip{right:12px;bottom:12px;}
}

#cx-help-fb-overlay{position:fixed;inset:0;z-index:2147483002;
  background:rgba(8,14,28,.55);backdrop-filter:blur(3px);
  display:none;align-items:center;justify-content:center;padding:24px;opacity:0;
  transition:opacity .22s cubic-bezier(.4,0,.2,1);}
#cx-help-fb-overlay.open{display:flex;opacity:1;}
#cx-help-fb-overlay .cxfm-dialog{
  width:min(920px,calc(100vw - 48px));height:min(760px,calc(100vh - 48px));
  background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(247,244,236,.96));
  border:1px solid rgba(130,100,40,.35);border-radius:14px;overflow:hidden;
  display:flex;flex-direction:column;
  transform:translateY(12px) scale(.97);
  transition:transform .28s cubic-bezier(.2,.8,.25,1.05);}
#cx-help-fb-overlay.open .cxfm-dialog{transform:translateY(0) scale(1);}
#cx-help-fb-overlay .cxfm-head{display:flex;align-items:center;gap:10px;padding:11px 12px;
  background:linear-gradient(180deg,#c9a84c 0%,#b89638 100%);color:#231708;
  border-bottom:1px solid rgba(130,100,40,.45);}
#cx-help-fb-overlay .cxfm-title{flex:1;font-family:'Playfair Display',Georgia,serif;
  font-weight:700;font-size:14.5px;color:#231708;}
#cx-help-fb-overlay .cxfm-close{background:rgba(255,255,255,.2);border:1px solid rgba(0,0,0,.2);
  color:#231708;width:26px;height:24px;padding:0;border-radius:6px;font-size:19px;cursor:pointer;}
#cx-help-fb-overlay .cxfm-frame-wrap{flex:1;min-height:0;background:#fff;}
#cx-help-fb-overlay iframe{width:100%;height:100%;border:0;display:block;background:#fff;}`;
    const style = document.createElement('style');
    style.id = 'cx-help-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ─── Constants ──────────────────────────────────────────────────────────
  const MOVE_THRESHOLD_PX = 6;
  const COOLDOWN_AFTER_DISMISS_MS = 4000;
  const MAX_HISTORY_TURNS = 6;
  const SNIPPET_MAX_CHARS = 1500;
  const STORAGE_ENABLED_KEY = 'cx_help_enabled';
  const HELP_CACHE_KEY = 'cx_help_cache_v1';
  const HELP_CACHE_MAX = 80;
  const HELP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const HOTKEY = 'F1';
  const DOUBLE_TAP_WINDOW_MS = 400;

  // ─── Hashing ────────────────────────────────────────────────────────────
  function fnv1aHash(s) {
    let h = 0x811c9dc5;
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }
  function cacheKeyFor(question, lang) {
    return fnv1aHash([
      question || '',
      state.lastElementSnippet || '',
      state.lastNearestHeading || '',
      state.lastViewName || '',
      String(lang || 'en'),
    ].join(''));
  }

  // ─── State ──────────────────────────────────────────────────────────────
  const state = {
    dwellMs: 3000,
    autoOpenEnabled: true,
    userEnabled: readEnabledPref(),
    dwellTimer: null,
    cooldownUntil: 0,
    lastX: 0, lastY: 0, lastMoveAt: 0,
    hoverTarget: null, card: null, chip: null,
    history: [], loading: false,
    lastElementSnippet: '',
    lastNearestHeading: '',
    lastViewName: '',
    lastLocationKey: '',
  };

  function readEnabledPref() {
    try {
      const v = localStorage.getItem(STORAGE_ENABLED_KEY);
      return v === null ? false : v === '1';
    } catch (_) { return false; }
  }
  function writeEnabledPref(on) {
    try { localStorage.setItem(STORAGE_ENABLED_KEY, on ? '1' : '0'); } catch (_) {}
  }

  function readHelpCache() {
    try {
      const raw = localStorage.getItem(HELP_CACHE_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : {};
    } catch (_) { return {}; }
  }
  function writeHelpCache(map) {
    try { localStorage.setItem(HELP_CACHE_KEY, JSON.stringify(map)); } catch (_) {}
  }
  function pruneHelpCache(map) {
    const now = Date.now();
    const kept = {};
    const entries = Object.entries(map)
      .filter(([, v]) => v && typeof v.a === 'string' && (now - (v.t || 0)) < HELP_CACHE_TTL_MS)
      .sort((a, b) => (b[1].t || 0) - (a[1].t || 0))
      .slice(0, HELP_CACHE_MAX);
    for (const [k, v] of entries) kept[k] = v;
    return kept;
  }

  // ─── Language ───────────────────────────────────────────────────────────
  function currentLang() {
    if (window.I18n && typeof window.I18n.lang === 'string') return window.I18n.lang;
    const re = new RegExp('(?:^|;\\s*)' + CFG.langCookie + '=([^;]+)');
    const m = document.cookie.match(re);
    return m ? decodeURIComponent(m[1]) : 'en';
  }
  function t(src) {
    if (window.I18n && typeof window.I18n.t === 'function') {
      try { return window.I18n.t(src); } catch (_) { return src; }
    }
    return src;
  }

  // ─── DOM context extraction ─────────────────────────────────────────────
  function isOurUI(el) {
    return !!(el && el.closest && el.closest('#cx-help-card, #cx-help-chip, #cx-help-fb-overlay'));
  }
  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function findMeaningfulContainer(el) {
    if (!el) return null;
    let cur = el, hops = 0;
    while (cur && cur !== document.body && hops < 8) {
      // App-specific interest selectors — extend this list to match your DOM.
      const interesting = cur.matches && cur.matches(
        '[data-help], [role="dialog"], .modal, .modal-overlay, .card, .stat-card, ' +
        '.nav-item, .form-row, .form-row-grid, .section-title, .topbar-title, ' +
        '.sidebar-logo, button, a, label, details'
      );
      if (interesting) return cur;
      const txt = (cur.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length >= 20) return cur;
      cur = cur.parentElement; hops++;
    }
    return el;
  }

  function nearestHeadingFor(el) {
    if (!el) return '';
    let cur = el, hops = 0;
    while (cur && cur !== document.body && hops < 12) {
      const h = cur.querySelector && cur.querySelector(
        'h1, h2, h3, h4, .section-title, .modal-title, .topbar-title'
      );
      if (h) {
        const txt = (h.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) return txt.slice(0, 200);
      }
      cur = cur.parentElement; hops++;
    }
    return (document.title || '').slice(0, 200);
  }

  function elementSnippet(el) {
    if (!el) return '';
    const container = findMeaningfulContainer(el);
    if (!container) return '';
    const clone = container.cloneNode(true);
    clone.querySelectorAll('script, style, svg, #cx-help-card, #cx-help-chip').forEach(n => n.remove());
    let text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > SNIPPET_MAX_CHARS) text = text.slice(0, SNIPPET_MAX_CHARS) + '…';
    return text;
  }

  function currentViewName() {
    const navActive = document.querySelector('.nav-item.active [data-i18n], .nav-item.active span');
    if (navActive) {
      const x = (navActive.textContent || '').trim();
      if (x) return x;
    }
    const topbar = document.getElementById('topbar-title');
    if (topbar) {
      const x = (topbar.textContent || '').trim();
      if (x) return x;
    }
    return '';
  }

  function locationKeyFor(el) {
    if (!el || el === document.body) return '';
    const slug = (s) => String(s || '').trim().toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    let cur = el, hops = 0;
    while (cur && cur !== document.body && hops < 10) {
      if (cur.dataset && cur.dataset.help) return 'help:' + slug(cur.dataset.help);
      if (cur.id) return 'id:' + slug(cur.id);
      if (cur.dataset && cur.dataset.view) return 'view:' + slug(cur.dataset.view);
      if (cur.dataset && cur.dataset.task) return 'task:' + slug(cur.dataset.task);
      cur = cur.parentElement; hops++;
    }
    const heading = nearestHeadingFor(el);
    if (heading) return 'sec:' + slug(heading);
    const tag = (el.tagName || 'el').toLowerCase();
    const cls = (el.className && typeof el.className === 'string')
      ? el.className.split(/\s+/).filter(Boolean)[0] : '';
    return 'el:' + tag + (cls ? '.' + slug(cls) : '');
  }

  // ─── Feedback launcher (optional) ───────────────────────────────────────
  function mapLangForWizard(lang) {
    if (!lang) return 'en';
    const l = String(lang).toLowerCase();
    if (l === 'zh') return 'zh-CN';
    return l;
  }
  function buildFeedbackUrl() {
    if (!CFG.feedbackUrl) return '';
    const dom = (() => {
      const name = (document.getElementById('user-name')?.textContent || '').trim();
      const looksLikeName = name && name !== 'Loading…' && name !== '—';
      return { userName: looksLikeName ? name : '' };
    })();
    const pathKey = (location.pathname || '/').replace(/\/+$/, '') || '/';
    const loc = state.lastLocationKey || 'loc:unknown';
    const sourceID = CFG.appSlug + ':' + pathKey + ':' + loc;
    const c = {
      sourceID, lang: mapLangForWizard(currentLang()),
      domain: 'general', reading_level: 'professional', level: '1',
    };
    if (dom.userName) c.userName = dom.userName;
    return CFG.feedbackUrl + (CFG.feedbackUrl.includes('?') ? '&' : '?')
      + 'json=' + encodeURIComponent(JSON.stringify(c));
  }
  function openFeedbackWizard() {
    if (!CFG.feedbackUrl) return;
    const url = buildFeedbackUrl();
    let overlay = document.getElementById('cx-help-fb-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'cx-help-fb-overlay';
      overlay.innerHTML = [
        '<div class="cxfm-dialog" role="dialog" aria-label="Feedback">',
        '  <div class="cxfm-head">',
        '    <div class="cxfm-title" data-i18n>Feedback</div>',
        '    <button type="button" class="cxfm-close" id="cxfm-close" aria-label="Close">&times;</button>',
        '  </div>',
        '  <div class="cxfm-frame-wrap"><iframe id="cxfm-frame" title="Feedback wizard" allow="clipboard-write"></iframe></div>',
        '</div>',
      ].join('');
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFeedbackWizard(); });
      overlay.querySelector('#cxfm-close').addEventListener('click', closeFeedbackWizard);
      window.addEventListener('message', (e) => {
        const d = e && e.data;
        if (!d) return;
        const kind = (typeof d === 'string') ? d : (d.type || d.kind || '');
        if (/^(feedback[_-]?)?(done|submitted|close|cancel)$/i.test(String(kind))) closeFeedbackWizard();
      });
      if (window.I18n && I18n.applyTo) I18n.applyTo(overlay);
    }
    overlay.querySelector('#cxfm-frame').src = url;
    overlay.offsetHeight;
    overlay.classList.add('open');
    document.addEventListener('keydown', onFeedbackKey);
  }
  function closeFeedbackWizard() {
    const overlay = document.getElementById('cx-help-fb-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    const f = overlay.querySelector('#cxfm-frame');
    if (f) setTimeout(() => { try { f.src = 'about:blank'; } catch (_) {} }, 220);
    document.removeEventListener('keydown', onFeedbackKey);
  }
  function onFeedbackKey(e) { if (e.key === 'Escape') closeFeedbackWizard(); }

  // ─── API ────────────────────────────────────────────────────────────────
  async function fetchConfig() {
    try {
      const r = await fetch(CFG.api.config, { credentials: 'same-origin' });
      if (!r.ok) return;
      const cfg = await r.json();
      if (typeof cfg.dwellMs === 'number') state.dwellMs = Math.max(0, cfg.dwellMs);
      state.autoOpenEnabled = !!cfg.enabled;
    } catch (_) {}
  }

  async function askServer(question) {
    const lang = currentLang();
    const assistantTurnsSoFar = state.history.filter(m => m.role === 'assistant').length;
    const key = assistantTurnsSoFar === 0 ? cacheKeyFor(question, lang) : null;
    if (key) {
      const cache = readHelpCache();
      const hit = cache[key];
      if (hit && typeof hit.a === 'string' && hit.a) {
        hit.t = Date.now();
        writeHelpCache(cache);
        state.history.push({ role: 'assistant', content: hit.a, cached: true });
        renderMessages();
        return;
      }
    }
    state.loading = true;
    renderMessages();
    try {
      const r = await fetch(CFG.api.ask, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-app-lang': lang },
        body: JSON.stringify({
          question,
          elementSnippet: state.lastElementSnippet,
          nearestHeading: state.lastNearestHeading,
          viewName: state.lastViewName,
          pageTitle: document.title || '',
          locationKey: state.lastLocationKey || '',
          pathKey: ((location.pathname || '/').replace(/\/+$/, '') || '/'),
          lang,
          history: state.history.slice(-MAX_HISTORY_TURNS * 2),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      const answer = String(data.answer || '').trim();
      state.history.push({ role: 'assistant', content: answer });
      if (key && answer) {
        const cache = readHelpCache();
        cache[key] = { a: answer, t: Date.now() };
        writeHelpCache(pruneHelpCache(cache));
      }
    } catch (e) {
      state.history.push({ role: 'assistant',
        content: '⚠︎ ' + t('Help unavailable') + ': ' + (e.message || String(e)) });
    } finally {
      state.loading = false;
      renderMessages();
    }
  }

  // ─── Chip ───────────────────────────────────────────────────────────────
  function buildChip() {
    if (state.chip) return state.chip;
    const chip = document.createElement('button');
    chip.id = 'cx-help-chip';
    chip.type = 'button';
    chip.setAttribute('aria-label', 'Open help assistant');
    // English source string only — see "echo-of-source guard" in CONTEXT_HELP.md
    chip.setAttribute('title', 'Help assistant — double-tap Shift, click, or pause the cursor anywhere');
    chip.setAttribute('data-i18n-attr', 'title');
    chip.innerHTML = '<span>?</span>';
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isCardOpen()) closeCard();
      else openCardAt(null, { manual: true });
    });
    document.body.appendChild(chip);
    state.chip = chip;
    if (window.I18n && I18n.applyTo) I18n.applyTo(chip);
    return chip;
  }

  // ─── Markdown (tiny) ────────────────────────────────────────────────────
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderMarkdown(raw) {
    if (raw == null) return '';
    const src = String(raw);
    const codeBlocks = [];
    const fenceStripped = src.replace(/```([a-zA-Z0-9_-]*)?\n([\s\S]*?)```/g, (_, lang, body) => {
      const id = codeBlocks.length;
      codeBlocks.push('<pre class="cxh-code"><code>' + escapeHTML(body.replace(/\n+$/, '')) + '</code></pre>');
      return ' CB' + id + ' ';
    });
    let text = escapeHTML(fenceStripped);
    text = text.replace(/`([^`\n]+)`/g, (_, c) => '<code class="cxh-ic">' + c + '</code>');
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const lines = text.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      const h = line.match(/^(#{1,3})\s+(.+)$/);
      if (h) {
        const level = h[1].length + 3;
        out.push('<h' + level + ' class="cxh-h">' + h[2] + '</h' + level + '>');
        i++; continue;
      }
      if (/^\s*&gt;\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++;
        }
        out.push('<blockquote class="cxh-bq">' + buf.join('<br>') + '</blockquote>');
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push('<li>' + lines[i].replace(/^\s*\d+\.\s+/, '') + '</li>'); i++;
        }
        out.push('<ol class="cxh-ol">' + items.join('') + '</ol>');
        continue;
      }
      if (/^\s*[-*•]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
          items.push('<li>' + lines[i].replace(/^\s*[-*•]\s+/, '') + '</li>'); i++;
        }
        out.push('<ul class="cxh-ul">' + items.join('') + '</ul>');
        continue;
      }
      const para = [line]; i++;
      while (i < lines.length
        && !/^\s*$/.test(lines[i])
        && !/^(#{1,3})\s+/.test(lines[i])
        && !/^\s*&gt;\s?/.test(lines[i])
        && !/^\s*\d+\.\s+/.test(lines[i])
        && !/^\s*[-*•]\s+/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push('<p class="cxh-p">' + para.join('<br>') + '</p>');
    }
    let html = out.join('');
    html = html.replace(/ CB(\d+) /g, (_, id) => codeBlocks[+id] || '');
    return html;
  }

  // ─── Card ───────────────────────────────────────────────────────────────
  function buildCard() {
    if (state.card) return state.card;
    const card = document.createElement('div');
    card.id = 'cx-help-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Help assistant');
    const fbBtnHTML = CFG.feedbackUrl
      ? '<button type="button" class="cxh-fb" id="cxh-fb" data-i18n-attr="title" title="Share feedback">'
        + '<span aria-hidden="true">✎</span><span data-i18n>Feedback</span></button>'
      : '';
    card.innerHTML = [
      '<div class="cxh-head" id="cxh-drag-handle">',
      '  <div class="cxh-title"><span class="cxh-dot"></span><span data-i18n>Need help here?</span></div>',
      '  <div class="cxh-head-actions">',
      '    <button type="button" class="cxh-toggle" id="cxh-toggle" data-i18n-attr="title" title="Toggle auto-open on hover"></button>',
      fbBtnHTML,
      '    <button type="button" class="cxh-max" id="cxh-max" aria-label="Maximize" data-i18n-attr="title" title="Maximize">⛶</button>',
      '    <button type="button" class="cxh-close" id="cxh-close" aria-label="Close">&times;</button>',
      '  </div>',
      '</div>',
      '<div class="cxh-context" id="cxh-context"></div>',
      '<div class="cxh-msgs" id="cxh-msgs"></div>',
      '<div class="cxh-quickrow">',
      '  <button type="button" class="cxh-quick" data-q="what-is" data-i18n>What is this?</button>',
      '  <button type="button" class="cxh-quick" data-q="what-can" data-i18n>What can I do here?</button>',
      '  <button type="button" class="cxh-quick" data-q="why" data-i18n>Why is this here?</button>',
      '</div>',
      '<div class="cxh-inputrow">',
      '  <input type="text" class="cxh-input" id="cxh-input" data-i18n-attr="placeholder" placeholder="Ask a follow-up about this area…">',
      '  <button type="button" class="cxh-send" id="cxh-send" data-i18n>Send</button>',
      '</div>',
      '<div class="cxh-foot" data-i18n>' + escapeHTML(CFG.footerText) + '</div>',
    ].join('');
    document.body.appendChild(card);

    card.querySelector('#cxh-close').addEventListener('click', () => closeCard());
    card.querySelector('#cxh-toggle').addEventListener('click', () => {
      state.userEnabled = !state.userEnabled;
      writeEnabledPref(state.userEnabled);
      updateToggleLabel();
    });
    card.querySelectorAll('.cxh-quick').forEach(b => {
      b.addEventListener('click', () => {
        if (state.loading) return;
        const kind = b.getAttribute('data-q');
        const q = kind === 'what-is' ? t('What is this?')
               : kind === 'what-can' ? t('What can I do here?')
               : t('Why is this here and why is the app designed this way?');
        submit(q);
      });
    });
    const inputEl = card.querySelector('#cxh-input');
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const v = inputEl.value.trim();
        if (v) { inputEl.value = ''; submit(v); }
      }
    });
    card.querySelector('#cxh-send').addEventListener('click', () => {
      const v = inputEl.value.trim();
      if (v) { inputEl.value = ''; submit(v); }
    });
    card.addEventListener('mousemove', (e) => e.stopPropagation(), true);

    if (CFG.feedbackUrl) {
      card.querySelector('#cxh-fb').addEventListener('click', openFeedbackWizard);
    }

    card.querySelector('#cxh-msgs').addEventListener('click', (e) => {
      const btn = e.target.closest('.cxh-tts');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-turn'), 10);
      if (Number.isFinite(idx)) onSpeakTurnClick(idx);
    });

    const maxBtn = card.querySelector('#cxh-max');
    maxBtn.addEventListener('click', () => {
      const on = card.classList.toggle('maximized');
      maxBtn.textContent = on ? '❐' : '⛶';
      maxBtn.setAttribute('title', on ? t('Restore') : t('Maximize'));
      if (!on) {
        card.style.left = ''; card.style.top = ''; card.style.width = ''; card.style.height = '';
        positionCardNear(state.lastX || null, state.lastY || null);
      }
    });

    const handle = card.querySelector('#cxh-drag-handle');
    let drag = null;
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;
      if (card.classList.contains('maximized')) return;
      const rect = card.getBoundingClientRect();
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      card.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const W = card.offsetWidth, H = card.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight, margin = 8;
      let left = e.clientX - drag.dx;
      let top = e.clientY - drag.dy;
      left = Math.max(margin, Math.min(left, vw - W - margin));
      top = Math.max(margin, Math.min(top, vh - H - margin));
      card.style.left = left + 'px'; card.style.top = top + 'px';
      card.style.right = 'auto'; card.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return; drag = null; card.classList.remove('dragging');
    });

    state.card = card;
    if (window.I18n && I18n.applyTo) I18n.applyTo(card);
    updateToggleLabel();
    return card;
  }

  function updateToggleLabel() {
    const btn = state.card && state.card.querySelector('#cxh-toggle');
    if (!btn) return;
    if (state.userEnabled) { btn.textContent = t('Auto-help: on');  btn.classList.add('on'); }
    else                   { btn.textContent = t('Auto-help: off'); btn.classList.remove('on'); }
  }
  function isCardOpen() { return !!(state.card && state.card.classList.contains('open')); }

  function positionCardNear(x, y) {
    const card = state.card;
    if (!card) return;
    if (card.classList.contains('maximized')) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const W = card.offsetWidth || 380, H = card.offsetHeight || 320, margin = 16;
    let left, top;
    if (x == null || y == null) { left = vw - W - margin; top = vh - H - margin; }
    else {
      left = x + 18; top = y + 18;
      if (left + W + margin > vw) left = Math.max(margin, x - W - 18);
      if (top + H + margin > vh)  top  = Math.max(margin, y - H - 18);
      left = Math.max(margin, Math.min(left, vw - W - margin));
      top  = Math.max(margin, Math.min(top,  vh - H - margin));
    }
    card.style.left = Math.round(left) + 'px';
    card.style.right = 'auto'; card.style.bottom = 'auto';
    card.style.top = Math.round(top) + 'px';
  }

  function captureContextFrom(el) {
    state.lastElementSnippet = elementSnippet(el);
    state.lastNearestHeading = nearestHeadingFor(el);
    state.lastViewName = currentViewName();
    state.lastLocationKey = locationKeyFor(el);
  }

  function renderContextChip() {
    const el = state.card && state.card.querySelector('#cxh-context');
    if (!el) return;
    const bits = [];
    if (state.lastNearestHeading) bits.push(state.lastNearestHeading);
    if (state.lastViewName && state.lastViewName !== state.lastNearestHeading) bits.push(state.lastViewName);
    const label = bits.join(' · ') || t('This area');
    el.innerHTML = '<span class="cxh-context-label">' + t('Context') + ':</span> '
      + '<span class="cxh-context-val">' + escapeHTML(label) + '</span>';
  }

  function renderMessages() {
    const el = state.card && state.card.querySelector('#cxh-msgs');
    if (!el) return;
    const turns = state.history.slice();
    if (turns.length === 0 && !state.loading) {
      el.innerHTML = '<div class="cxh-empty" data-i18n>'
        + 'Pause on anything — or tap a question below to learn what this is and what you can do here.'
        + '</div>';
    } else {
      el.innerHTML = turns.map((m, idx) => {
        if (m.role === 'user') return '<div class="cxh-msg user">' + escapeHTML(m.content) + '</div>';
        const hasText = typeof m.content === 'string' && m.content.trim().length > 0;
        const tts = (hasText && ttsSupportedHere()) ? ttsButtonHTML(idx) : '';
        return '<div class="cxh-msg bot">' + renderMarkdown(m.content) + tts + '</div>';
      }).join('')
      + (state.loading ? '<div class="cxh-msg bot loading"><span data-i18n>Thinking…</span></div>' : '');
    }
    if (window.I18n && I18n.applyTo) I18n.applyTo(el);
    el.scrollTop = el.scrollHeight;
    if (speak.activeTurn >= 0 && speak.state !== 'idle') setTtsButton(speak.activeTurn, speak.state);
  }

  function submit(question) {
    stopSpeakAudio();
    state.history.push({ role: 'user', content: question });
    renderMessages();
    askServer(question);
  }

  function openCardAt(event, opts) {
    buildCard();
    const target = (event && event.target) || state.hoverTarget || document.body;
    captureContextFrom(target);
    renderContextChip();
    state.history = []; state.loading = false;
    renderMessages();
    if (event && typeof event.clientX === 'number') positionCardNear(event.clientX, event.clientY);
    else positionCardNear(null, null);
    void state.card.offsetHeight;
    requestAnimationFrame(() => {
      state.card.classList.add('open');
      if (event && typeof event.clientX === 'number') positionCardNear(event.clientX, event.clientY);
      else positionCardNear(null, null);
    });
    if (opts && opts.autoFirst) submit(t('What is this, and what can I do here?'));
  }

  function closeCard() {
    if (!state.card) return;
    stopSpeakAudio();
    state.card.classList.remove('open');
    state.cooldownUntil = Date.now() + COOLDOWN_AFTER_DISMISS_MS;
  }

  // ─── TTS (optional) ─────────────────────────────────────────────────────
  const speak = { audio: null, activeTurn: -1, state: 'idle' };
  const TTS_ICON_PLAY = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  const TTS_ICON_STOP = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  const TTS_ICON_LOAD = '<span class="cxh-tts-spin" aria-hidden="true"></span>';

  function ttsSupportedHere() {
    if (!CFG.api.tts) return false;
    if (!window.I18n || !Array.isArray(I18n.languages)) return true;
    const code = (I18n.lang || 'en').toLowerCase();
    const meta = I18n.languages.find(l => l && l.code === code);
    if (!meta) return true;
    return meta.tts !== false;
  }
  function ttsButtonHTML(turnIdx) {
    return '<div class="cxh-tts-row">'
      + '<button type="button" class="cxh-tts" data-turn="' + turnIdx + '" '
      + 'aria-label="' + t('Read this answer aloud') + '" '
      + 'title="' + t('Read this answer aloud') + '">'
      + TTS_ICON_PLAY
      + '<span class="cxh-tts-label" data-i18n>Read aloud</span>'
      + '</button></div>';
  }
  function ttsButtonFor(turnIdx) {
    return state.card && state.card.querySelector('.cxh-tts[data-turn="' + turnIdx + '"]');
  }
  function setTtsButton(turnIdx, kind) {
    const btn = ttsButtonFor(turnIdx);
    if (!btn) return;
    btn.classList.remove('is-playing', 'is-busy');
    const labelSpan = '<span class="cxh-tts-label" data-i18n>';
    if (kind === 'playing') {
      btn.classList.add('is-playing');
      btn.innerHTML = TTS_ICON_STOP + labelSpan + t('Stop') + '</span>';
    } else if (kind === 'loading') {
      btn.classList.add('is-busy');
      btn.innerHTML = TTS_ICON_LOAD + labelSpan + t('Loading…') + '</span>';
    } else {
      btn.innerHTML = TTS_ICON_PLAY + labelSpan + t('Read aloud') + '</span>';
    }
  }
  function stopSpeakAudio() {
    if (speak.audio) {
      try { speak.audio.pause(); } catch (_) {}
      try { URL.revokeObjectURL(speak.audio.src); } catch (_) {}
      speak.audio = null;
    }
    if (speak.activeTurn >= 0) setTtsButton(speak.activeTurn, 'idle');
    speak.activeTurn = -1;
    speak.state = 'idle';
  }
  function prepareTurnTextForTts(raw) {
    let text = String(raw || '');
    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
      .replace(/(^|[\s(])_([^_\n]+)_/g, '$1$2')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\s+/g, ' ').trim();
    return text.slice(0, 2500);
  }
  async function onSpeakTurnClick(turnIdx) {
    if (!CFG.api.tts) return;
    if (speak.activeTurn === turnIdx) {
      if (speak.state === 'loading') return;
      if (speak.state === 'playing') { stopSpeakAudio(); return; }
    }
    if (speak.activeTurn !== -1) stopSpeakAudio();
    const turn = state.history[turnIdx];
    if (!turn || turn.role !== 'assistant') return;
    const text = prepareTurnTextForTts(turn.content);
    if (!text) return;
    speak.activeTurn = turnIdx;
    speak.state = 'loading';
    setTtsButton(turnIdx, 'loading');
    try {
      const r = await fetch(CFG.api.tts, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-app-lang': currentLang() },
        body: JSON.stringify({ text, lang: currentLang() }),
      });
      if (!r.ok) { stopSpeakAudio(); return; }
      if (speak.activeTurn !== turnIdx) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      speak.audio = audio;
      audio.addEventListener('ended', stopSpeakAudio);
      audio.addEventListener('error', stopSpeakAudio);
      await audio.play();
      speak.state = 'playing';
      setTtsButton(turnIdx, 'playing');
    } catch (_) { stopSpeakAudio(); }
  }

  // ─── Triggers (dwell + hotkey) ──────────────────────────────────────────
  function clearDwell() {
    if (state.dwellTimer) { clearTimeout(state.dwellTimer); state.dwellTimer = null; }
  }
  function shouldIgnoreTarget(el) {
    if (!el) return true;
    if (isOurUI(el)) return true;
    if (isTypingTarget(el)) return true;
    return false;
  }
  function onMove(e) {
    state.lastMoveAt = Date.now();
    state.hoverTarget = e.target;
    state.lastX = e.clientX; state.lastY = e.clientY;
    if (isCardOpen()) return;
    if (!state.autoOpenEnabled || !state.userEnabled) return;
    if (Date.now() < state.cooldownUntil) return;
    if (shouldIgnoreTarget(e.target)) { clearDwell(); return; }
    clearDwell();
    state.dwellTimer = setTimeout(() => {
      const elNow = document.elementFromPoint(state.lastX, state.lastY);
      if (!elNow || shouldIgnoreTarget(elNow)) return;
      if (isCardOpen()) return;
      openCardAt({ target: elNow, clientX: state.lastX, clientY: state.lastY }, { autoFirst: true });
    }, state.dwellMs);
  }
  function onLeave() { clearDwell(); }
  function openHelpAtCursor() {
    if (isCardOpen()) { closeCard(); return; }
    let el = null, x = state.lastX, y = state.lastY;
    if (state.lastMoveAt > 0 && state.hoverTarget && document.body.contains(state.hoverTarget) && !isOurUI(state.hoverTarget)) {
      el = state.hoverTarget;
    } else if (document.activeElement && document.activeElement !== document.body && !isOurUI(document.activeElement)) {
      el = document.activeElement;
      const rect = el.getBoundingClientRect();
      x = rect.left + Math.min(rect.width / 2, 120);
      y = rect.bottom + 4;
    } else {
      el = document.body;
      x = Math.floor(window.innerWidth / 2);
      y = Math.floor(window.innerHeight / 2);
    }
    openCardAt({ target: el, clientX: x, clientY: y }, { autoFirst: true });
  }

  let lastShiftDownAt = 0;
  let shiftSequenceBroken = false;
  function onKey(e) {
    if (e.key === 'Escape' && isCardOpen()) closeCard();
    if (e.key === 'Shift' && !e.repeat) {
      const now = Date.now();
      if (!shiftSequenceBroken && lastShiftDownAt && (now - lastShiftDownAt) < DOUBLE_TAP_WINDOW_MS) {
        e.preventDefault(); e.stopPropagation();
        lastShiftDownAt = 0; shiftSequenceBroken = false;
        openHelpAtCursor();
        return;
      }
      lastShiftDownAt = now; shiftSequenceBroken = false;
      return;
    }
    if (lastShiftDownAt && e.key !== 'Shift') shiftSequenceBroken = true;
    if (e.key === HOTKEY || e.code === HOTKEY) {
      e.preventDefault(); e.stopPropagation();
      openHelpAtCursor();
    }
  }

  // ─── Boot ───────────────────────────────────────────────────────────────
  function boot() {
    injectStyles();
    buildChip();
    window.addEventListener('i18n:languagechange', () => {
      stopSpeakAudio();
      if (state.chip && window.I18n && I18n.applyTo) I18n.applyTo(state.chip);
      if (state.card) {
        if (window.I18n && I18n.applyTo) I18n.applyTo(state.card);
        updateToggleLabel(); renderContextChip(); renderMessages();
      }
    });
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('keydown', onKey, true);
    fetchConfig();
    window.contextualHelp = {
      open: () => openCardAt(null, { manual: true }),
      openAt: (x, y) => openCardAt({ target: document.elementFromPoint(x, y) || document.body, clientX: x, clientY: y }, { autoFirst: true }),
      close: closeCard,
      state: () => ({ ...state, card: !!state.card, chip: !!state.chip }),
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
```

---

## 11. Reference server — Express + persistence interface

Node/Express skeleton. Bring your own `llm.callLLM()`, `store` (KV with CAS), and `loadGroundingDoc()`.

### 11.1 Persistence contract

```js
// store.js — implement this interface against GCS / S3 / Firestore / Redis / fs.
// All methods are async. `mutate` is CAS-safe read-modify-write.
//
//   mutate(key, initial, transform):
//     1. read current doc at key (or use `initial` if missing)
//     2. call transform(current) → next
//     3. write next, retrying on concurrent-modification errors
//     4. resolve with the post-mutation doc
//
//   listByPrefix(prefix, { limit }):
//     return an array of { key, doc } pairs.

module.exports = {
  async get(key) { /* return doc or null */ },
  async set(key, doc) { /* overwrite */ },
  async mutate(key, initial, transform) { /* CAS read-modify-write */ },
  async listByPrefix(prefix, { limit = 500 } = {}) { /* prefix scan */ },
};
```

### 11.2 `bumpHelpStat` — the analytics primitive

```js
// helpStats.js
const store = require('./store');

async function bumpHelpStat(cacheKey, { served, update = {} } = {}) {
  return store.mutate(`cache/${cacheKey}.json`, null, (cur) => {
    const nowMs = Date.now();
    const base = cur || { askCount: 0, hitCount: 0, createdAtMs: nowMs };
    const next = {
      ...base,
      ...update,
      askCount: (base.askCount || 0) + 1,
      hitCount: (base.hitCount || 0) + (served === 'hit' ? 1 : 0),
      updatedAtMs: nowMs,
      updatedAt: new Date().toISOString(),
    };
    if (update.analytics) {
      next.analytics = { ...(base.analytics || {}), ...update.analytics };
    }
    return next;
  });
}

async function listHelpStats({ limit = 500 } = {}) {
  return store.listByPrefix('cache/help:', { limit });
}

module.exports = { bumpHelpStat, listHelpStats };
```

### 11.3 The three core routes

```js
// routes/help.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { bumpHelpStat, listHelpStats } = require('../helpStats');
const llm = require('../llm');                  // your provider dispatcher
const loadGroundingDoc = require('../grounding'); // returns { markdown } — or () => ({ markdown: '' })

const APP_SLUG = process.env.APP_SLUG || 'app';
const DWELL_MS = parseInt(process.env.HELP_HOVER_DWELL_MS || '3000', 10);

const langFromReq = (req) =>
  (req.query.lang || req.get('x-app-lang') || req.cookies?.lang || 'en').toLowerCase();
const labelFor = (code) => ({ en: 'English', zh: 'Chinese', es: 'Spanish' /* extend */ }[code] || 'English');
const shortHash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

// ── GET /api/config/help-hover ────────────────────────────────────────────
router.get('/config/help-hover', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ dwellMs: DWELL_MS, enabled: DWELL_MS > 0 });
});

// ── POST /api/help/ask ────────────────────────────────────────────────────
const CAPS = { question: 800, snippet: 2000, heading: 200, view: 80,
               pageTitle: 200, locationKey: 120, pathKey: 200,
               historyTurns: 8, historyTurnChars: 1200 };

router.post('/help/ask', async (req, res) => {
  try {
    const b = req.body || {};
    const question = String(b.question || '').trim();
    if (question.length > CAPS.question) return res.status(400).json({ error: 'question too long' });
    const snippet        = String(b.elementSnippet || '').trim().slice(0, CAPS.snippet);
    const nearestHeading = String(b.nearestHeading || '').trim().slice(0, CAPS.heading);
    const viewName       = String(b.viewName || '').trim().slice(0, CAPS.view);
    const pageTitle      = String(b.pageTitle || '').trim().slice(0, CAPS.pageTitle);
    const locationKey    = String(b.locationKey || '').trim().slice(0, CAPS.locationKey);
    const pathKey        = (String(b.pathKey || '/').trim().slice(0, CAPS.pathKey)) || '/';
    const locationId     = `${APP_SLUG}:${pathKey}:${locationKey || 'loc:unknown'}`;

    const lang = langFromReq(req);
    const langName = labelFor(lang);

    const rawHistory = Array.isArray(b.history) ? b.history : [];
    const history = rawHistory
      .filter(t => t && typeof t.role === 'string' && typeof t.content === 'string')
      .slice(-CAPS.historyTurns)
      .map(t => ({ role: t.role === 'assistant' ? 'assistant' : 'user',
                   content: t.content.slice(0, CAPS.historyTurnChars) }));

    const { markdown: grounding } = await loadGroundingDoc(); // '' if you have no grounding doc

    const system = [
      'You are the contextual help assistant inside this app.',
      'The user paused over a part of the UI and is asking what it is or what',
      'they can do with it. Be a friendly, concrete tour guide — NOT a coach or evaluator.',
      '',
      'Rules:',
      '- 2–5 sentences default. Plain language.',
      '- Light markdown is rendered: **bold** for the key term, *italic* for subtle emphasis,',
      '  `inline code` for exact UI labels, short bullet lists when you genuinely need 2–4 options.',
      '- The DOM snippet below is authoritative for what is actually on screen. Describe buttons,',
      '  fields, and sections using the words that appear there. Never invent UI not present.',
      '- If the snippet is a form input, tell them what to type and why it matters.',
      '- If the snippet is a button, tell them what happens when they click it.',
      '- For purpose/design questions, ground the answer in the document below.',
      '- If the snippet is too ambiguous, say so and suggest hovering on a more specific area.',
      `- Respond in ${langName}. Do not switch languages mid-answer.`,
      grounding ? '\n═══ GROUNDING DOC (authoritative for purpose questions) ═══\n' + grounding : '',
    ].join('\n');

    const ctx = [];
    ctx.push(`Page: ${pageTitle || '(unknown)'}${viewName ? `  ·  View: ${viewName}` : ''}`);
    if (nearestHeading) ctx.push(`Nearest heading: ${nearestHeading}`);
    ctx.push('', 'Visible UI under the cursor (text content, trimmed):', '"""',
      snippet || '(the cursor was not over any meaningful element)', '"""');
    if (history.length) {
      ctx.push('', 'Prior turns in this help thread:');
      for (const t of history) ctx.push(`${t.role === 'user' ? 'User' : 'You'}: ${t.content}`);
    }
    ctx.push('');
    if (question) ctx.push(`User's question: ${question}`);
    else ctx.push(
      'User has not typed a question yet — they paused on this part of the UI.',
      'Open with one sentence telling them what this is, then one sentence telling them',
      'the smallest useful next action they could take here.'
    );
    ctx.push('', `Respond directly in ${langName}. Do not repeat the question.`);

    const userPrompt = ctx.join('\n');

    const isFirstTurn = history.length === 0;
    const hasSnippet = !!snippet;
    const cacheKey = (isFirstTurn && hasSnippet)
      ? `help:${shortHash(system + '' + userPrompt)}` : null;
    const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

    const analytics = {
      locationId, locationKey: locationKey || 'loc:unknown', pathKey,
      nearestHeading, viewName, pageTitle,
      locationHint: snippet.slice(0, 160),
      question: question || '(auto-first)',
      lang,
    };

    if (cacheKey) {
      const cached = await require('../store').get(`cache/${cacheKey}.json`);
      if (cached && cached.answer && Date.now() - (cached.updatedAtMs || 0) < CACHE_TTL_MS) {
        bumpHelpStat(cacheKey, { served: 'hit', update: { analytics } })
          .catch(err => console.warn('[help] hit bump failed', err.message));
        return res.json({ answer: cached.answer, cached: true });
      }
    }

    const answer = (await llm.callLLM({
      system, user: userPrompt, maxTokens: 400, usageType: 'help',
    }) || '').trim();

    if (cacheKey && answer) {
      await bumpHelpStat(cacheKey, { served: 'miss', update: { answer, lang, analytics } });
    }
    res.json({ answer, cached: false });
  } catch (e) {
    console.error('[help/ask]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/help-analytics ─────────────────────────────────────────
router.get('/admin/help-analytics', /* requireAdmin, */ async (req, res) => {
  try {
    const group = req.query.group === 'none' ? 'none' : 'location';
    const limit = Math.min(2000, Math.max(50, parseInt(req.query.limit, 10) || 500));
    const entries = await listHelpStats({ limit });

    let totalAsks = 0, totalHits = 0;
    for (const { doc } of entries) {
      totalAsks += Number(doc.askCount || 0);
      totalHits += Number(doc.hitCount || 0);
    }

    if (group === 'none') {
      const rows = entries.map(({ key, doc }) => ({
        cacheKey: key,
        locationId: doc.analytics?.locationId || null,
        askCount: Number(doc.askCount || 0),
        hitCount: Number(doc.hitCount || 0),
        lang: doc.lang || doc.analytics?.lang || null,
        viewName: doc.analytics?.viewName || '',
        nearestHeading: doc.analytics?.nearestHeading || '',
        question: doc.analytics?.question || '',
        locationHint: doc.analytics?.locationHint || '',
        firstAskedAt: doc.createdAtMs || null,
        lastAskedAt: doc.updatedAtMs || null,
      })).sort((a, b) => b.askCount - a.askCount);
      return res.json({ totalHashes: entries.length, totalAsks, totalHits, entries: rows });
    }

    const byLoc = new Map();
    for (const { key, doc } of entries) {
      const a = doc.analytics || {};
      const id = a.locationId || `${APP_SLUG}:(unknown):loc:unknown`;
      let row = byLoc.get(id);
      if (!row) {
        row = {
          locationId: id, pathKey: a.pathKey || '', locationKey: a.locationKey || '',
          viewName: a.viewName || '', nearestHeading: a.nearestHeading || '',
          askCount: 0, hitCount: 0, hashCount: 0, langs: {},
          _questions: new Map(), sampleAnswer: '', sampleCacheKey: '',
          firstAskedAt: null, lastAskedAt: null, _maxAskInLoc: 0,
        };
        byLoc.set(id, row);
      }
      const asks = Number(doc.askCount || 0);
      const hits = Number(doc.hitCount || 0);
      row.askCount += asks; row.hitCount += hits; row.hashCount += 1;
      const lang = doc.lang || a.lang || 'unknown';
      row.langs[lang] = (row.langs[lang] || 0) + asks;
      const q = a.question || '';
      if (q) row._questions.set(q, (row._questions.get(q) || 0) + asks);
      if (asks > row._maxAskInLoc) {
        row._maxAskInLoc = asks;
        row.viewName = a.viewName || row.viewName;
        row.nearestHeading = a.nearestHeading || row.nearestHeading;
        row.sampleAnswer = String(doc.answer || '').slice(0, 400);
        row.sampleCacheKey = key;
      }
      const f = Number(doc.createdAtMs || 0), l = Number(doc.updatedAtMs || 0);
      if (f && (!row.firstAskedAt || f < row.firstAskedAt)) row.firstAskedAt = f;
      if (l && (!row.lastAskedAt  || l > row.lastAskedAt))  row.lastAskedAt  = l;
    }

    const locations = Array.from(byLoc.values()).map(r => {
      const topQuestions = Array.from(r._questions.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([q, count]) => ({ q, count }));
      delete r._questions; delete r._maxAskInLoc;
      return { ...r, topQuestions };
    }).sort((a, b) => b.askCount - a.askCount);

    res.json({ totalHashes: entries.length, totalAsks, totalHits, locations });
  } catch (e) {
    console.error('[help/analytics]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

### 11.4 Optional `POST /api/tts`

```js
// routes/tts.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const store = require('../store');

const TTS_MAX_CHARS = 2500;
const TTS_DEFAULT_VOICE = 'alloy';
const TTS_DEFAULT_MODEL = 'gpt-4o-mini-tts';
const TTS_SUPPORTS_INSTRUCTIONS = (m) => /^gpt-4o/i.test(m || '');

// Languages without TTS voice coverage. Extend per your provider.
const TTS_UNSUPPORTED_LANGS = new Set(['my', 'km', 'lo', 'bn', 'te', 'si', 'mn']);

function ttsCacheKey({ model, voice, lang, instructions, text }) {
  const norm = [String(model || ''), String(voice || ''), String(lang || ''),
                String(instructions || ''), String(text || '')].join('');
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 40);
}

router.post('/tts', async (req, res) => {
  try {
    const b = req.body || {};
    const text = (typeof b.text === 'string' ? b.text : '')
      .replace(/\s+/g, ' ').trim().slice(0, TTS_MAX_CHARS);
    if (!text) return res.status(400).json({ error: 'text required' });
    const voice = (typeof b.voice === 'string' && b.voice.trim()) ? b.voice.trim().slice(0, 32) : TTS_DEFAULT_VOICE;
    const model = (typeof b.model === 'string' && b.model.trim()) ? b.model.trim().slice(0, 64) : TTS_DEFAULT_MODEL;

    const lang = typeof b.lang === 'string' ? b.lang : '';
    if (TTS_UNSUPPORTED_LANGS.has(lang.toLowerCase())) {
      return res.status(415).json({ error: 'tts not supported for this language', lang });
    }
    const instructions = (typeof b.instructions === 'string' ? b.instructions.trim() : '').slice(0, 500);
    const effectiveInstr = TTS_SUPPORTS_INSTRUCTIONS(model) ? instructions : '';

    const key = ttsCacheKey({ model, voice, lang, instructions: effectiveInstr, text });
    res.set('X-TTS-Cache-Key', key);

    // Try cache
    try {
      const cached = await store.getBuffer(`cache/tts/${key}.mp3`);
      if (cached && cached.length) {
        res.set('Content-Type', 'audio/mpeg');
        res.set('Cache-Control', 'no-store');
        res.set('X-TTS-Cache', 'hit');
        return res.send(cached);
      }
    } catch (e) { console.warn('[tts] cache read', e.message); }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OPENAI_API_KEY is not configured' });
    }
    const payload = { model, voice, input: text, response_format: 'mp3' };
    if (effectiveInstr) payload.instructions = effectiveInstr;

    const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      const err = await upstream.text().catch(() => '');
      return res.status(502).json({ error: 'tts upstream failed', detail: err.slice(0, 300) });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.set('X-TTS-Cache', 'miss');
    res.send(buf);

    // Persist fire-and-forget
    Promise.all([
      store.putBuffer(`cache/tts/${key}.mp3`, buf, 'audio/mpeg'),
      store.putBuffer(`cache/tts/${key}.json`,
        Buffer.from(JSON.stringify({ key, model, voice, lang, instructions: effectiveInstr,
          text, bytes: buf.length, createdAt: new Date().toISOString() })),
        'application/json; charset=utf-8'),
    ]).catch(e => console.warn('[tts] persist failed', e.message));
  } catch (e) {
    console.error('[tts]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

### 11.5 Reference filesystem store (for local dev)

```js
// store.fs.js — simple disk-backed implementation of the persistence contract.
// Production deployments should swap this for GCS / S3 / Firestore / Redis.
const fs = require('fs').promises;
const path = require('path');

const ROOT = process.env.HELP_STORE_DIR || './data';
const pathFor = (k) => path.join(ROOT, k);

async function ensureDir(p) { await fs.mkdir(path.dirname(p), { recursive: true }); }

module.exports = {
  async get(key) {
    try {
      const buf = await fs.readFile(pathFor(key));
      return JSON.parse(buf.toString('utf8'));
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  },
  async set(key, doc) {
    const p = pathFor(key); await ensureDir(p);
    await fs.writeFile(p, JSON.stringify(doc));
  },
  async mutate(key, initial, transform) {
    // Simple non-atomic implementation. For production CAS, use file locks
    // (e.g. proper-lockfile) or swap in a real CAS-capable store.
    const cur = (await this.get(key)) || initial;
    const next = transform(cur);
    await this.set(key, next);
    return next;
  },
  async listByPrefix(prefix, { limit = 500 } = {}) {
    const root = pathFor(prefix.replace(/[^\/]+$/, ''));
    const files = await fs.readdir(root).catch(() => []);
    const out = [];
    for (const f of files) {
      if (out.length >= limit) break;
      if (!f.startsWith(prefix.split('/').pop())) continue;
      const key = path.join(prefix.replace(/[^\/]+$/, ''), f).replace(/\.json$/, '');
      const doc = await this.get(key + '.json');
      if (doc) out.push({ key, doc });
    }
    return out;
  },
  async getBuffer(key) {
    try { return await fs.readFile(pathFor(key)); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  },
  async putBuffer(key, buf /*, contentType */) {
    const p = pathFor(key); await ensureDir(p); await fs.writeFile(p, buf);
  },
};
```

### 11.6 Server wiring

```js
// app.js
const express = require('express');
const cookieParser = require('cookie-parser');
const helpRoutes = require('./routes/help');
const ttsRoutes = require('./routes/tts');           // optional

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// Public — used pre-sign-in by login pages, etc.
app.use('/api', helpRoutes);
app.use('/api', ttsRoutes);                          // optional

app.listen(process.env.PORT || 3000);
```

---

## 12. HTML inclusion

One script tag per page (public and authenticated). The module is idempotent.

```html
<script src="/contextual-help.js?v=1"></script>
```

The bottom-right "?" chip appears immediately. Double-tap Shift, F1, click the chip, or — if the user opts in — pause the cursor for 3 seconds to open the card.

---

## 13. Tagging for stable analytics

Sprinkle `data-help="…"` onto elements you want unambiguous analytics for:

```html
<button data-help="upload-evidence" class="btn-primary">Upload evidence</button>

<section data-help="phase-1-workspace">
  <h2 class="section-title">Workspace</h2>
  …
</section>

<div class="task-tile" data-help="phase-1-task-2">…</div>
```

These keys feed `locationKeyFor()` at top priority and become the stable identity in `locationId` — they survive DOM refactors and remain correlatable with any external feedback / telemetry system that uses the same `{appSlug}:{pathKey}:{locationKey}` shape.

---

## 14. Environment variables

| Variable                | Default      | Purpose                                                                 |
|-------------------------|--------------|-------------------------------------------------------------------------|
| `APP_SLUG`              | `app`        | Namespace prefix in `locationId` (must match `CFG.appSlug` in client).  |
| `HELP_HOVER_DWELL_MS`   | `3000`       | Dwell time before auto-open. `0` disables the auto-open path globally.  |
| `HELP_STORE_DIR`        | `./data`     | Root of the filesystem store reference impl (dev only).                 |
| `OPENAI_API_KEY`        | —            | Required only if you wire `POST /api/tts`.                              |

That's the whole feature.
