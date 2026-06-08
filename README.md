# 优城美市 · Our Block

> Your block, in good hands — together.

A place-based civic-wellbeing app where residents notice what is **good** and flag what
**needs care**, then act. Designed as a psychological-empowerment intervention: capture is
location-aware, photo and short video document the environment, and an AI routes each
observation to the *lowest viable rung* of action — tend-it-yourself, rally-neighbours, or
send-to-the-city.

Built from the approved interface mockup in [`docs/index.html`](docs/index.html), which is
preserved unchanged for reference.

## Stack

- **Backend** — Node.js + Express + SQLite (`better-sqlite3`), JWT cookie auth, `multer` uploads
- **Frontend** — vanilla-JS single-page app (no build step), faithful to the mockup's design system
- **AI routing** — transparent keyword heuristic by default; upgrades to Claude automatically
  when `ANTHROPIC_API_KEY` is set

## Quick start

```bash
npm install
npm run reset     # create + seed the demo database
npm start         # http://localhost:3000
```

Demo neighbour: **`ling@ourblock.org`** / **`ourblock`**

```bash
npm run dev       # auto-restart on changes
npm test          # API integration tests (isolated temp DB)
```

## How it maps to the empowerment model

| UI element | Mechanism |
|---|---|
| One-tap capture | Behavioural component — lowers friction to act |
| Photo + short video + auto-GPS | Evidence-rich, situated awareness |
| Two streams: Good ✦ / Needs Care △ | Capitalization (savoring) vs. critical awareness |
| Location-sensitive feed ("within 1.2 km") | Situated efficacy |
| AI action-ladder suggestion | Learned hopefulness — every issue keeps a path to act |
| "My impact" + "Our block this month" | Intrapersonal self-efficacy + collective efficacy |

## API

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/auth/config` | tells the SPA whether Google / gateway auth is enabled |
| `GET` | `/api/auth/google/start` · `/google/callback` | Google sign-in via the OAuth gateway |
| `POST` | `/api/auth/register` · `/verify` · `/resend-code` | email signup → SMTP code → verify |
| `POST` | `/api/auth/login` · `/logout` | local demo accounts first, then the gateway |
| `POST` | `/api/auth/forgot-password` · `/reset-password` · `/change-password` | password management (gateway + SMTP) |
| `GET` | `/api/auth/me` · `PUT /api/auth/me/location` | current user / re-anchor location |
| `GET` | `/api/posts` | `stream`, `sort=new\|near\|top`, `radius`, `mine`, `limit`, `offset` |
| `GET` | `/api/posts/pins` · `/api/posts/:id` | map pins / single post + comments |
| `POST` | `/api/posts` | create — AI classifies & routes |
| `POST` | `/api/posts/:id/react` | toggle `cheer` \| `help` \| `metoo` |
| `POST` | `/api/posts/:id/advance` | `send_report` → `in_progress` → `resolve` (owner only) |
| `POST` | `/api/posts/:id/comments` · `DELETE /api/posts/:id` | reply / remove own post |
| `POST` | `/api/upload` | photo or short video |
| `GET` | `/api/stats/me` · `/api/stats/community` | intrapersonal & collective efficacy |

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | server port |
| `JWT_SECRET` | dev fallback | sign session tokens (set in production) |
| `OAUTH_GATEWAY_URL` | `https://oauth.xiangenhu.info` | OAuth2 & SMTP proxy gateway |
| `OAUTH_ENABLED` | `on` | set `off` to use local-only bcrypt auth (no gateway/email) |
| `PUBLIC_URL` | derived from request | this app's public origin, for the Google `redirect_uri` |

## Authentication

Sign-in is delegated to the **OAuth2 & SMTP Proxy Gateway**
([oauth.xiangenhu.info](https://oauth.xiangenhu.info), see `/instruction`):

- **Continue with Google** → `/api/auth/google/start` redirects to the gateway, which
  handles Google consent and returns a token to `/api/auth/google/callback`; the app reads
  the verified profile from the gateway and starts a session.
- **Email + password** → `/register` asks the gateway to email a 6-digit code via its SMTP
  proxy; `/verify` confirms it and signs the user in. `/forgot-password` + `/reset-password`
  and `/change-password` round out account management — all SMTP-backed by the gateway.

The gateway owns credentials and email delivery. Our Block keeps a lightweight **profile**
record (keyed by email) so posts, reactions and stats reference a stable user id; it is
upserted on every successful gateway auth. Seeded demo accounts (e.g. `ling@ourblock.org`)
still sign in locally via bcrypt, so the demo works with `OAUTH_ENABLED=off` too.

The gateway's own Google client id, JWT/session secrets and `GMAIL_APP_PASSWORD` are
configured **on the gateway**, not in this app.

**Callback URL.** The gateway needs an absolute `redirect_uri`, but the app never hardcodes
one. It is resolved in this order: `PUBLIC_URL` (explicit override) → the GitHub Codespaces
forwarded origin (auto-derived from `CODESPACE_NAME` + port, e.g.
`https://<name>-4000.app.github.dev/api/auth/google/callback`) → the browser's own origin
(sent by the SPA, validated against the request host) → the request host. So it follows
wherever the app is actually served — localhost, a Codespace, or a custom domain.
