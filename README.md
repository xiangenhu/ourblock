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
| `POST` | `/api/auth/register` · `/login` · `/logout` | cookie session + bearer token |
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
| `OURBLOCK_DB` | `data/ourblock.db` | database path (`:memory:` for tests) |
| `ANTHROPIC_API_KEY` | — | enables Claude-backed AI routing |

Uploaded media is stored under `public/uploads/` and the SQLite database under `data/` —
both are gitignored.
