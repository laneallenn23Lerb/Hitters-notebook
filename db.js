// Database layer: SQLite (better-sqlite3) for local dev, Postgres when DATABASE_URL is set.
// All queries use "?" placeholders; they are converted to $1, $2... for Postgres automatically.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const usePg = !!process.env.DATABASE_URL;
let pgPool = null;
let sqlite = null;

if (usePg) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });
} else {
  const Database = require('better-sqlite3');
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, 'data', 'hitting-app.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
}

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

// SELECT-style queries -> array of row objects
async function query(sql, params = []) {
  if (usePg) {
    const res = await pgPool.query(toPg(sql), params);
    return res.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

// INSERT/UPDATE/DELETE -> nothing returned
async function run(sql, params = []) {
  if (usePg) {
    await pgPool.query(toPg(sql), params);
    return;
  }
  sqlite.prepare(sql).run(...params);
}

function newId() {
  return crypto.randomUUID();
}
function nowIso() {
  return new Date().toISOString();
}

async function init() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    game_id TEXT,
    at_bat_number INTEGER,
    date TEXT,
    opponent TEXT,
    context TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    reflection TEXT DEFAULT '',
    takeaways TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_entries_user_type ON entries(user_id, type)`);

  await run(`CREATE TABLE IF NOT EXISTS searches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, term)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS blueprint_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
}

module.exports = { query, run, init, newId, nowIso, usePg };
