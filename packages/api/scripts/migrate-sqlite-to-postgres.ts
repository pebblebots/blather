/**
 * One-way production backfill from the legacy SQLite task/deal databases into
 * Postgres. A marker beside each retained source file prevents stale replays.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sql } from 'drizzle-orm';
import { createDb, dealChanges, deals, taskComments, tasks } from '@blather/db';

type SqliteRow = Record<string, unknown>;
const pg = createDb();
const force = process.env.FORCE_SQLITE_BACKFILL === '1';

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function date(value: unknown): Date {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid SQLite timestamp: ${String(value)}`);
  return parsed;
}

function rows(db: DatabaseSync, table: string): SqliteRow[] {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return exists ? db.prepare(`SELECT * FROM ${table}`).all() as SqliteRow[] : [];
}

async function migrateTasks(path: string): Promise<void> {
  const marker = `${path}.postgres-migrated`;
  if (!existsSync(path)) return console.log(`[backfill] No task database at ${path}; skipping.`);
  if (existsSync(marker) && !force) return console.log(`[backfill] Task marker exists; skipping stale replay.`);

  const sqlite = new DatabaseSync(path, { readOnly: true });
  try {
    const taskRows = rows(sqlite, 'tasks');
    const commentRows = rows(sqlite, 'task_comments');
    await pg.transaction(async (tx) => {
      for (const row of taskRows) {
        const values = {
          id: String(row.id), title: String(row.title), description: nullable(row.description),
          priority: String(row.priority) as 'urgent' | 'normal' | 'low',
          status: String(row.status) as 'queued' | 'in_progress' | 'done',
          assigneeId: nullable(row.assigneeId), claimedById: nullable(row.claimedById),
          creatorId: nullable(row.creatorId),
          ...(row.shortId == null ? {} : { shortId: Number(row.shortId) }),
          sourceChannelId: nullable(row.sourceChannelId),
          completionArtifact: nullable(row.completionArtifact ?? row.completion_artifact),
          createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
        };
        await tx.insert(tasks).values(values).onConflictDoUpdate({ target: tasks.id, set: values });
      }
      for (const row of commentRows) {
        const values = {
          id: String(row.id), taskId: String(row.taskId), userId: String(row.userId),
          content: String(row.content), createdAt: date(row.createdAt),
        };
        await tx.insert(taskComments).values(values).onConflictDoUpdate({ target: taskComments.id, set: values });
      }
      await tx.execute(sql`SELECT setval('tasks_short_id_seq', COALESCE((SELECT MAX(short_id) FROM tasks), 0) + 1, false)`);
    });
    writeFileSync(marker, `Migrated at ${new Date().toISOString()}\n`);
    console.log(`[backfill] Tasks: ${taskRows.length}; comments: ${commentRows.length}.`);
  } finally {
    sqlite.close();
  }
}

async function migrateDeals(path: string): Promise<void> {
  const marker = `${path}.postgres-migrated`;
  if (!existsSync(path)) return console.log(`[backfill] No deal database at ${path}; skipping.`);
  if (existsSync(marker) && !force) return console.log(`[backfill] Deal marker exists; skipping stale replay.`);

  const sqlite = new DatabaseSync(path, { readOnly: true });
  try {
    const dealRows = rows(sqlite, 'deals');
    const changeRows = rows(sqlite, 'deal_changes');
    await pg.transaction(async (tx) => {
      for (const row of dealRows) {
        const values = {
          id: String(row.id), name: String(row.name), company: nullable(row.company),
          stage: String(row.stage) as 'sourcing' | 'dd' | 'pass' | 'move' | 'portfolio',
          thesis: nullable(row.thesis), contacts: nullable(row.contacts),
          sourceAgentId: nullable(row.source_agent_id), sourceChannelId: nullable(row.source_channel_id),
          round: nullable(row.round), amount: nullable(row.amount), leadInvestor: nullable(row.lead_investor),
          notes: nullable(row.notes),
          ...(row.shortId == null ? {} : { shortId: Number(row.shortId) }),
          externalId: nullable(row.external_id),
          externalSource: nullable(row.external_source), updatedByAgentId: nullable(row.updated_by_agent_id),
          status: String(row.status) as 'active' | 'watchlist' | 'zombie' | 'inactive' | 'exited',
          nextMeetingAt: nullable(row.next_meeting_at), archived: Boolean(row.archived),
          createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
        };
        await tx.insert(deals).values(values).onConflictDoUpdate({ target: deals.id, set: values });
      }
      for (const row of changeRows) {
        const values = {
          id: String(row.id), dealId: String(row.deal_id), agentId: nullable(row.agent_id),
          field: String(row.field), oldValue: nullable(row.old_value), newValue: nullable(row.new_value),
          changeType: String(row.change_type), createdAt: date(row.created_at),
        };
        await tx.insert(dealChanges).values(values).onConflictDoUpdate({ target: dealChanges.id, set: values });
      }
      await tx.execute(sql`SELECT setval(pg_get_serial_sequence('deals', 'short_id'), COALESCE((SELECT MAX(short_id) FROM deals), 0) + 1, false)`);
    });
    writeFileSync(marker, `Migrated at ${new Date().toISOString()}\n`);
    console.log(`[backfill] Deals: ${dealRows.length}; changes: ${changeRows.length}.`);
  } finally {
    sqlite.close();
  }
}

async function main(): Promise<void> {
  const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
  await migrateTasks(process.env.TASKS_DB_PATH ?? resolve(repositoryRoot, 'data', 'tasks.db'));
  await migrateDeals(process.env.DEALS_DB_PATH ?? resolve(repositoryRoot, 'data', 'deals.db'));
  console.log('[backfill] Complete. SQLite sources retained.');
  process.exit(0);
}

main().catch((error) => {
  console.error('[backfill] Failed; no marker was written for the failed database.', error);
  process.exit(1);
});
