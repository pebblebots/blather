import { logAgentActivity, isAgentUser } from "./activity.js";
import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { tasks, taskComments, users } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';

export const taskRoutes = new Hono<Env>();
taskRoutes.use('*', authMiddleware);

type TaskStatus = 'queued' | 'in_progress' | 'done';
const VALID_STATUSES: TaskStatus[] = ['queued', 'in_progress', 'done'];

function normalizeStatus(s: string): TaskStatus {
  const mapped = s.replace(/-/g, '_');
  if (!VALID_STATUSES.includes(mapped as TaskStatus)) throw new Error('Invalid status: ' + s);
  return mapped as TaskStatus;
}

// List tasks for a workspace
taskRoutes.get('/', async (c) => {
  const db = c.get('db');
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

  const conditions: any[] = [eq(tasks.workspaceId, workspaceId)];
  const status = c.req.query('status');
  if (status) conditions.push(eq(tasks.status, normalizeStatus(status)));
  const priority = c.req.query('priority');
  if (priority) conditions.push(eq(tasks.priority, priority as any));
  const assignee = c.req.query('assigneeId');
  if (assignee) conditions.push(eq(tasks.assigneeId, assignee));

  const result = await db.select().from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt));

  return c.json(result);
});

// Create task
taskRoutes.post('/', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const body = await c.req.json<{
    workspaceId: string;
    title: string;
    description?: string;
    priority?: 'urgent' | 'normal' | 'low';
    assigneeId?: string;
    sourceChannelId?: string;
  }>();

  if (!body.workspaceId || !body.title) {
    return c.json({ error: 'workspaceId and title required' }, 400);
  }

  const [task] = await db.insert(tasks).values({
    workspaceId: body.workspaceId,
    title: body.title,
    description: body.description ?? null,
    priority: body.priority ?? 'normal',
    assigneeId: body.assigneeId ?? null,
    creatorId: userId,
    sourceChannelId: body.sourceChannelId ?? null,
  } as any).returning();

  // Auto-log agent task creation (fire-and-forget)
  isAgentUser(db, userId).then(isAgent => {
    if (isAgent) logAgentActivity(db, {
      workspaceId: body.workspaceId, userId, action: 'task_created',
      metadata: { taskId: task.id, title: task.title, shortId: task.shortId },
    });
  }).catch(() => {});
  return c.json(task, 201);
});

// Update task (with status change notification)
taskRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{
    title?: string;
    description?: string | null;
    priority?: 'urgent' | 'normal' | 'low';
    status?: 'queued' | 'in_progress' | 'done';
    assigneeId?: string | null;
  }>();

  // Fetch current task for status comparison
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) return c.json({ error: 'Task not found' }, 404);

  const updates: any = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.status !== undefined) updates.status = normalizeStatus(body.status);
  if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;

  const [task] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();

  // Status change notification
  if (body.status !== undefined && normalizeStatus(body.status) !== existing.status) {
    const sourceChannelId = existing.sourceChannelId;
    if (sourceChannelId) {
      try {
        const { postStatusNotification } = await import('../bots/taskNotify.js');
        await postStatusNotification(db, task, existing.status, normalizeStatus(body.status), userId);
      } catch (e) {
        console.error('[Tasks] Status notification error:', e);
      }
    }
  }

  // Auto-log agent task update (fire-and-forget)
  isAgentUser(db, userId).then(isAgent => {
    if (!isAgent) return;
    const action = body.status === 'done' ? 'task_completed' : 'task_updated';
    logAgentActivity(db, {
      workspaceId: existing.workspaceId, userId, action,
      metadata: { taskId: task.id, title: task.title, shortId: task.shortId, status: body.status },
    });
  }).catch(() => {});
  return c.json(task);
});

// Delete task
taskRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [task] = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  if (!task) return c.json({ error: 'Task not found' }, 404);

  return c.json({ ok: true });
});

// ── Task Comments ──

// List comments
taskRoutes.get('/:taskId/comments', async (c) => {
  const db = c.get('db');
  const taskId = c.req.param('taskId');

  const result = await db.select({
    id: taskComments.id,
    taskId: taskComments.taskId,
    userId: taskComments.userId,
    content: taskComments.content,
    createdAt: taskComments.createdAt,
    userDisplayName: users.displayName,
  })
    .from(taskComments)
    .leftJoin(users, eq(taskComments.userId, users.id))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(taskComments.createdAt);

  return c.json(result);
});

// Add comment
taskRoutes.post('/:taskId/comments', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const taskId = c.req.param('taskId');
  const body = await c.req.json<{ content: string }>();

  if (!body.content?.trim()) {
    return c.json({ error: 'content required' }, 400);
  }

  // Verify task exists
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const [comment] = await db.insert(taskComments).values({
    taskId,
    userId,
    content: body.content.trim(),
  }).returning();

  return c.json(comment, 201);
});

// Delete comment (only by author)
taskRoutes.delete('/:taskId/comments/:commentId', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const commentId = c.req.param('commentId');

  const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, commentId));
  if (!comment) return c.json({ error: 'Comment not found' }, 404);
  if (comment.userId !== userId) return c.json({ error: 'Not authorized' }, 403);

  await db.delete(taskComments).where(eq(taskComments.id, commentId));
  return c.json({ ok: true });
});
