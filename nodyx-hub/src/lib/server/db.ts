import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.HUB_DB_PATH ?? path.resolve(__dirname, '../../../../../hub.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      ip          TEXT
    );

    CREATE TABLE IF NOT EXISTS newsletter (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      subject     TEXT NOT NULL,
      body_html   TEXT NOT NULL,
      recipients  INTEGER DEFAULT 0,
      sent_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      cpu_pct     REAL,
      mem_pct     REAL,
      disk_pct    REAL,
      online_inst INTEGER,
      total_inst  INTEGER,
      total_members INTEGER,
      online_members INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics_history(ts);
  `);
}
