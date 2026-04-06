/**
 * Migration script: copy tasks + comments from Postgres → SQLite.
 *
 * Run BEFORE deploying the new code (while Postgres still has the task tables):
 *   npx tsx packages/api/scripts/migrate-tasks-to-sqlite.ts
 *
 * Idempotent: tasks/comments already present in SQLite are skipped.
 */

import { sql } from 'drizzle-orm';
import { createDb } from '@blather/db';
import { getTaskDb } from '../src/tasks/db.js';

async function main() {
  const pgDb = createDb();
  const sqliteDb = getTaskDb();

  console.log('[migrate] Reading tasks from Postgres...');

  // Use raw SQL so we don't depend on the Drizzle schema exports (which are being removed)
  const tasksResult = await pgDb.execute(sql`
    SELECT id, title, description, priority, status,
           assignee_id AS "assigneeId", creator_id AS "creatorId",
           short_id AS "shortId", source_channel_id AS "sourceChannelId",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM tasks
    ORDER BY created_at ASC
  `);

  const pgTasks: any[] = (tasksResult as any).rows ?? (tasksResult as any);
  console.log(`[migrate] Found ${pgTasks.length} tasks.`);

  const commentsResult = await pgDb.execute(sql`
    SELECT id, task_id AS "taskId", user_id AS "userId",
           content, created_at AS "createdAt"
    FROM task_comments
    ORDER BY created_at ASC
  `);

  const pgComments: any[] = (commentsResult as any).rows ?? (commentsResult as any);
  console.log(`[migrate] Found ${pgComments.length} comments.`);

  const insertTask = sqliteDb.prepare(`
    INSERT OR IGNORE INTO tasks
      (id, title, description, priority, status, assigneeId, creatorId, shortId, sourceChannelId, createdAt, updatedAt)
    VALUES
      (@id, @title, @description, @priority, @status, @assigneeId, @creatorId, @shortId, @sourceChannelId, @createdAt, @updatedAt)
  `);

  const insertComment = sqliteDb.prepare(`
    INSERT OR IGNORE INTO task_comments (id, taskId, userId, content, createdAt)
    VALUES (@id, @taskId, @userId, @content, @createdAt)
  `);

  // Also keep the shortId sequence in sync
  const insertSeq = sqliteDb.prepare(`
    INSERT OR IGNORE INTO task_short_id_seq (id) VALUES (@id)
  `);

  let tasksMigrated = 0;
  let commentsSkipped = 0;

  const migrateAll = sqliteDb.transaction(() => {
    for (const t of pgTasks) {
      const result = insertTask.run({
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        priority: t.priority,
        status: t.status,
        assigneeId: t.assigneeId ?? null,
        creatorId: t.creatorId ?? null,
        shortId: t.shortId ?? null,
        sourceChannelId: t.sourceChannelId ?? null,
        createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
        updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt),
      });
      if (result.changes > 0) {
        tasksMigrated++;
        if (t.shortId) {
          insertSeq.run({ id: t.shortId });
        }
      }
    }

    for (const c of pgComments) {
      const result = insertComment.run({
        id: c.id,
        taskId: c.taskId,
        userId: c.userId,
        content: c.content,
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
      });
      if (result.changes === 0) commentsSkipped++;
    }
  });

  migrateAll();

  console.log(`[migrate] Done. Tasks migrated: ${tasksMigrated} (${pgTasks.length - tasksMigrated} already present).`);
  console.log(`[migrate] Comments skipped (already present): ${commentsSkipped}.`);
  process.exit(0);
}

main().catch(err => {
  console.error('[migrate] Error:', err);
  process.exit(1);
});
