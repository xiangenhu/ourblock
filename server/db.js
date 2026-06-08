import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// OURBLOCK_DB lets tests point at an isolated database (use ':memory:' or a tmp path).
const DB_PATH = process.env.OURBLOCK_DB || path.join(DATA_DIR, 'ourblock.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  name_cjk      TEXT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  neighborhood  TEXT DEFAULT 'Jing''an, Shanghai',
  lat           REAL DEFAULT 31.2304,
  lng           REAL DEFAULT 121.4737,
  level         INTEGER DEFAULT 1,
  level_title   TEXT DEFAULT 'Steward',
  avatar_initial TEXT DEFAULT '·',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream       TEXT NOT NULL CHECK (stream IN ('good','care')),
  title        TEXT NOT NULL,
  body         TEXT DEFAULT '',
  media_type   TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo','video')),
  media_url    TEXT,
  duration_s   INTEGER,
  lat          REAL,
  lng          REAL,
  place_name   TEXT,
  ai_tag       TEXT,
  ai_category  TEXT,
  ai_action    TEXT CHECK (ai_action IN ('self','rally','city')),
  ai_confidence REAL,
  ai_summary   TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','rallying','routed','in_progress','resolved')),
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_stream ON posts(stream);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);

CREATE TABLE IF NOT EXISTS reactions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type      TEXT NOT NULL CHECK (type IN ('cheer','help','metoo')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, user_id, type)
);

CREATE TABLE IF NOT EXISTS loop_steps (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('done','active','pending')),
  position  INTEGER NOT NULL DEFAULT 0,
  detail    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body      TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

export default db;
