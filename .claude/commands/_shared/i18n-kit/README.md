# Hash-based i18n Kit — installable runtime

A **complete, installable** i18n implementation for **our stack** (Node.js + Express + GCS +
React): hash-keyed translations, on-demand LLM translation, and the in-app **Translation
Suggestion Mode** (teachers/admins correct translations in place; admins approve; the fix is
written straight into the live locale file).

This directory is self-contained. Copy it into another of our apps' `.claude/commands/_shared/`
(it travels with `team-i18n.md`), run the installer, do the 5 wiring steps, done.

> **Scope:** deliberately **not** framework-agnostic. It assumes our stack — Express router,
> a GCS-style storage service, React client. The only things that vary per app (storage service,
> auth middleware, LLM call) are injected into one factory.

---

## What it installs

```
runtime/client/                     → your app's client/src/i18n/
  hashUtils.js        getHash(text) = SHA-256(first-16); sync + async
  i18nUtils.js        dynamic-text helpers (addText/addTextSync), template gen
  I18nContext.jsx     <I18nProvider>, useI18n(), load/cache/localStorage, on-demand fetch
  I18nText.jsx        <I18nText> → <span data-i18n="{hash}">…</span> (+ on-demand translate on hover)
  SuggestionMode.jsx  the correction tool (toggle + click-delegation + modal) — decoupled via props
  SuggestionMode.css  styling (light/dark, RTL-safe, outline for active mode)
  index.js            barrel export
  AdminTranslationsTab.jsx   reference admin review UI (only with --admin-tab)

runtime/server/                     → your app's server/i18n/
  i18nRoutes.js       createI18nRouter({...}) — locale serve/merge, /translate, /suggestions*

runtime/locales/en.json             → seeds your app's client/public/locales/en.json
```

---

## Quick start

```bash
# from the target app root (or pass --app <path>)
node .claude/commands/_shared/i18n-kit/install.mjs --admin-tab

# options
#   --app <dir>          target app root (default: cwd)
#   --client-dir <dir>   default client/src/i18n
#   --server-dir <dir>   default server/i18n
#   --locales <dir>      default client/public/locales
#   --admin-tab          also copy AdminTranslationsTab.jsx
#   --force              overwrite existing files
#   --dry-run            print planned writes, change nothing
```

The installer copies the runtime and prints the manual wiring steps below.

---

## Integration contract

The host app must supply four things (everything else is in the runtime):

| # | Host provides | Passed to | Notes |
|---|---------------|-----------|-------|
| 1 | **GCS storage service** with `isConfigured()`, `uploadFile(buf, name, {folder,contentType,cacheControl})`, `downloadFile(path)→Buffer` (rejects if missing), `listFiles(prefix)→[{name}]` | `createI18nRouter({ storage })` | This is our standard `services/storage.js` shape. |
| 2 | **Auth middleware** — Express arrays `requireTeacher` / `requireAdmin` (e.g. `[requireAuth, requireRole('instructor','admin', …)]`) | `createI18nRouter({ requireTeacher, requireAdmin })` | `req.user.email` is recorded on suggestions when present. Omit → routes are unguarded (dev only). |
| 3 | **Role check + auth header** on the client (who may suggest; how to authenticate) | `<SuggestionMode canUse={…} getAuthHeaders={…} />` | `canUse` = your `isTeacher()||isAdmin()`. |
| 4 | **LLM translate fn** (optional) `({text,targetLang,languageName,req})→Promise<string>` | `createI18nRouter({ llmTranslate })` | Enables `POST /translate` (on-demand). Omit → that route 503s; approved suggestions still work. |
| 5 | **LLM alternatives fn** (optional) `({english,current,lang,languageName,req})→Promise<string[]>` | `createI18nRouter({ llmSuggestAlternatives })` | Enables the modal's **"✨ Suggest with AI"** button (`POST /suggest-alternatives`). Omit → button 503s. |

### Debugging mode — open suggesting to everyone
By default only teacher/admin may *submit* suggestions (approve/reject is **always** admin-only).
Set **`I18N_SUGGEST_MODE=debugging`** (or pass `createI18nRouter({ suggestOpen: true, optionalAuth })`)
to let **any user, including guests on public/landing pages**, submit — handy for crowd-flagging bad
translations. It's safe because nothing goes live without admin approval. The client learns the mode
from the public `GET /suggest-config` (`{ mode, allowAny }`) and opens `<SuggestionMode>` accordingly.
Pass your guest-aware `optionalAuth` middleware so `req.user` is still captured when present.

---

## How it works

**The hash is the whole trick.** Every string renders as `<span data-i18n="{hash}">…</span>`, where
`{hash}` = `getHash(englishText)` (SHA-256, first 16 chars). That same hash keys the string in
`en.json` **and** in every locale file (`zh.json`, …). So from any rendered element you recover all
three pieces of a correction with zero extra state:

- **Original English** — `translations.en[hash]`
- **Current translation** — `translations[lang][hash]`
- **Identity to file against** — the hash + lang

**Suggestion loop:** toggle mode → a capture-phase click handler on `[data-i18n]` opens the modal →
submit `POST /server/i18n/suggestions` → stored as one GCS object `locales/suggestions/{id}.json`
(race-free per submission) → admin lists via `GET /suggestions` → **approve** calls
`applyTranslationToLocale` which merges `{hash: suggested}` into `locales/{lang}.json` in GCS and
invalidates the cache → the fix is live within the cache TTL. **Reject** just marks the record.

**On-demand translation:** when a string has no translation for the active language, `I18nText`
fetches `POST /translate` (debounced, deduped, throttled to 6 concurrent), which LLM-translates and
persists back into the locale file. Suggestion Mode then lets humans correct whatever the LLM got
wrong — the two features compose.

---

## Manual wiring (installer prints these too)

**1 · Client — wrap the app once** (`main.jsx`)
```jsx
import { I18nProvider } from './i18n';
<I18nProvider><App /></I18nProvider>
```

**2 · Client — render translatable text**
```jsx
import { I18nText } from './i18n';
<I18nText>Save changes</I18nText>   // → <span data-i18n="{hash}">…</span>
```

**3 · Client — mount the suggestion tool once** (inside your auth provider)
```jsx
import { SuggestionMode } from './i18n';
const { isTeacher, isAdmin, token } = useAuth();
<SuggestionMode
  canUse={isTeacher() || isAdmin()}                        // YOUR role check
  getAuthHeaders={() => ({ Authorization: `Bearer ${token}` })} />
```

**4 · Server — mount the router once** (`server.js`)
```js
const path = require('path');
const { createI18nRouter } = require('./i18n/i18nRoutes');
const storage = require('./services/storage');            // YOUR GCS service
const { requireTeacher, requireAdmin } = require('./middleware/auth');
const { llmGateway } = require('./services/llmGateway');

app.use('/server/i18n', createI18nRouter({
  storage, requireTeacher, requireAdmin,
  localesFsPath: path.join(__dirname, '../client/public/locales'),
  llmTranslate: async ({ text, targetLang, languageName }) => {
    const r = await llmGateway.chat(
      [{ role: 'user', content: `Translate to ${languageName}. Return ONLY the translation: "${text}"` }],
      { temperature: 0.1, maxTokens: 200 });
    const out = typeof r === 'string' ? r : (r?.content || '');
    return out.trim().replace(/^["']|["']$/g, '');
  }
}));
```
If you rate-limit, keep the on-demand path light: `app.use('/server/i18n/translate', translateLimiter)`
**before** the router mount.

**5 · Client — add 4 API wrappers** to your `api.js` (the client calls these; `SuggestionMode` itself
uses raw `fetch`, but the admin tab uses `api`):
```js
async submitTranslationSuggestion({ hash, lang, english, current, suggested }) {
  return fetchWithAuth(`${API_BASE}/i18n/suggestions`, { method:'POST',
    body: JSON.stringify({ hash, lang, english, current, suggested }) });
},
async getTranslationSuggestions(status) {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return fetchWithAuth(`${API_BASE}/i18n/suggestions${q}`);
},
async approveTranslationSuggestion(id, note) {
  return fetchWithAuth(`${API_BASE}/i18n/suggestions/${encodeURIComponent(id)}/approve`,
    { method:'POST', body: JSON.stringify({ note }) });
},
async rejectTranslationSuggestion(id, note) {
  return fetchWithAuth(`${API_BASE}/i18n/suggestions/${encodeURIComponent(id)}/reject`,
    { method:'POST', body: JSON.stringify({ note }) });
}
```

**6 · Admin (optional)** — add `AdminTranslationsTab` as a dashboard tab:
```jsx
import AdminTranslationsTab from './i18n/AdminTranslationsTab';
// tabs: { id:'translations', label:'Translations', icon:'🌐' }
{activeTab === 'translations' && <AdminTranslationsTab />}
```

---

## Endpoints (mounted under `/server/i18n`)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /locales/:lang.json` | public | Serve a locale (GCS → local fallback → auto-create from `en`) |
| `GET /languages` | public | List available locales |
| `POST /translate` | public | On-demand LLM translation of one string (needs `llmTranslate`) |
| `PUT /locales/:lang.json` | admin | Replace a whole locale file |
| `POST /invalidate-cache` | — | Clear translation cache |
| `POST /suggestions` | **teacher+** | Submit a correction |
| `GET /suggestions?status=` | **admin** | List queued corrections + counts |
| `POST /suggestions/:id/approve` | **admin** | Apply into live locale file |
| `POST /suggestions/:id/reject` | **admin** | Dismiss |

---

## Hard invariants (do not regress)

- **Only when display language ≠ source (`'en'`).** Client toggle hides and the server rejects
  `lang === 'en'` — there is nothing to correct in the original.
- **Teacher/admin to suggest; admin to review/approve.** Enforced by the injected middleware.
- **Approve writes live immediately** — reuses the on-demand merge path (`applyTranslationToLocale`
  → GCS merge → cache invalidate). No separate publish step.
- **Suggestions are one GCS object each** (`locales/suggestions/{id}.json`) — race-free writes; never
  bundled/committed; not locale files.
- **The tool's own chrome carries `data-suggest-ui`** and the click delegator skips that subtree, so
  the modal's own labels aren't themselves click-to-suggest targets.
- **Emojis stay outside `data-i18n` spans; no inline styles** (RTL). See `team-i18n.md`.

## Requirements

- `GCS_BUCKET_NAME` set (endpoints 503 otherwise — the whole persistence layer is GCS).
- At least one LLM provider if you want on-demand `/translate`.

## Verify after install

1. `GET /server/i18n/locales/en.json` → 200.
2. Load a page with `?lang=zh`; the 💬 pill appears for teacher/admin (not on `?lang=en`).
3. Toggle on, click a phrase, submit → 201.
4. Admin dashboard → Translations → Approve → re-fetch `locales/zh.json` shows the new string.

The kit ships a smoke test shape (submit → list → approve → verify locale → 409 on re-approve); run
the equivalent against your mount to confirm the loop.
