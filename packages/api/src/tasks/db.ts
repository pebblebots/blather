import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let _db: Database.Database | null = null;

export function getTaskDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.TASKS_DB_PATH ?? resolve(process.cwd(), 'data', 'tasks.db');

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
    CREATE TABLE IF NOT EXISTS task_short_id_seq (
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'queued',
      assigneeId TEXT,
      creatorId TEXT,
      shortId INTEGER,
      sourceChannelId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      userId TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);

  // Migration: add claimedById column if it doesn't exist
  const cols = _db.pragma('table_info(tasks)') as { name: string }[];
  if (!cols.some((c) => c.name === 'claimedById')) {
    _db.exec('ALTER TABLE tasks ADD COLUMN claimedById TEXT');
  }
  // Migration: add completionArtifact column if it doesn't exist.
  // On older DBs this was named completion_artifact (snake_case), which broke
  // the SELECT * -> Task mapping. Rename if present, otherwise add fresh.
  const refreshedCols = _db.pragma('table_info(tasks)') as { name: string }[];
  const hasSnake = refreshedCols.some((c) => c.name === 'completion_artifact');
  const hasCamel = refreshedCols.some((c) => c.name === 'completionArtifact');
  if (hasSnake && !hasCamel) {
    _db.exec('ALTER TABLE tasks RENAME COLUMN completion_artifact TO completionArtifact');
  } else if (!hasCamel) {
    _db.exec('ALTER TABLE tasks ADD COLUMN completionArtifact TEXT');
  }

  return _db;
}

/** For testing only — truncates all task data without closing the connection */
export function clearTaskDbForTesting(): void {
  const db = getTaskDb();
  db.exec('DELETE FROM task_comments; DELETE FROM tasks; DELETE FROM task_short_id_seq;');
}
