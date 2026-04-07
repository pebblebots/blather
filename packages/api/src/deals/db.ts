import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let _db: Database.Database | null = null;

export function getDealDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.DEALS_DB_PATH ?? resolve(process.cwd(), 'data', 'deals.db');

  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS deal_short_id_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );

    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT,
      stage TEXT NOT NULL DEFAULT 'sourcing',
      thesis TEXT,
      contacts TEXT,
      source_agent_id TEXT,
      source_channel_id TEXT,
      round TEXT,
      amount TEXT,
      lead_investor TEXT,
      notes TEXT,
      shortId INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  return _db;
}

/** For testing only — truncates all deal data without closing the connection */
export function clearDealDbForTesting(): void {
  const db = getDealDb();
  db.exec('DELETE FROM deals; DELETE FROM deal_short_id_seq;');
}
