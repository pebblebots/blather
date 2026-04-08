import { logAgentActivity, isAgentUser } from "./activity.js";
import { Hono } from 'hono';
import { inArray } from 'drizzle-orm';
import { users } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  listTasks,
  createTask,
  getTask,
  updateTask,
  deleteTask,
  getTaskClaimConflict,
  listComments,
  addComment,
  getComment,
  deleteComment,
  TaskClaimConflictError,
} from '../tasks/queries.js';
import type { TaskStatus, TaskPriority } from '../tasks/queries.js';

export const taskRoutes = new Hono<Env>();
taskRoutes.use('*', authMiddleware);

const VALID_STATUSES: TaskStatus[] = ['queued', 'in_progress', 'done'];

function normalizeStatus(s: string): TaskStatus {
  const mapped = s.replace(/-/g, '_');
  if (!VALID_STATUSES.includes(mapped as TaskStatus)) throw new Error('Invalid status: ' + s);
  return mapped as TaskStatus;
}

// List tasks
taskRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const priority = c.req.query('priority');
  const assignee = c.req.query('assigneeId');

  const result = listTasks({
    status: status ? normalizeStatus(status) : undefined,
    priority: priority as TaskPriority | undefined,
    assigneeId: assignee,
  });

  return c.json(result);
});

// Create task
taskRoutes.post('/', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const body = await c.req.json<{
    title: string;
    description?: string;
    priority?: TaskPriority;
    assigneeId?: string;
    sourceChannelId?: string;
  }>();

  if (!body.title) {
    return c.json({ error: 'title required' }, 400);
  }

  const task = createTask({
    title: body.title,
    description: body.description ?? null,
    priority: body.priority ?? 'normal',
    assigneeId: body.assigneeId ?? null,
    creatorId: userId,
    sourceChannelId: body.sourceChannelId ?? null,
  });

  // Auto-log agent task creation (fire-and-forget)
  isAgentUser(db, userId).then(isAgent => {
    if (isAgent) logAgentActivity(db, {
      userId, action: 'task_created',
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
    priority?: TaskPriority;
    status?: string;
    assigneeId?: string | null;
  }>();

  // Fetch current task for status comparison
  const existing = getTask(id);
  if (!existing) return c.json({ error: 'Task not found' }, 404);

  const updates: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    assigneeId?: string | null;
  } = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.status !== undefined) updates.status = normalizeStatus(body.status);
  if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;

  // Check claim conflict before updating — return rich 409 with claimer info
  if (updates.status === 'in_progress') {
    const conflict = getTaskClaimConflict(id, userId);
    if (conflict) {
      let claimedByName: string | null = null;
      try {
        const [claimer] = await db
          .select({ displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, [conflict.claimedById]));
        if (claimer) claimedByName = claimer.displayName;
      } catch {}
      return c.json({
        error: 'Task already claimed',
        claimedById: conflict.claimedById,
        ...(claimedByName ? { claimedByName } : {}),
      }, 409);
    }
  }

  let task;
  try {
    task = updateTask(id, updates, userId);
  } catch (e) {
    if (e instanceof TaskClaimConflictError) {
      return c.json({ error: 'Task already claimed', claimedById: (e as any).message }, 409);
    }
    throw e;
  }
  if (!task) return c.json({ error: 'Task not found' }, 404);

  // Status change notification
  if (body.status !== undefined && normalizeStatus(body.status) !== existing.status) {
    if (existing.sourceChannelId) {
      try {
        const { notifyStatusChange } = await import('../bots/tasks.js');
        await notifyStatusChange(db, task, existing.status, normalizeStatus(body.status), userId);
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
      userId, action,
      metadata: { taskId: task.id, title: task.title, shortId: task.shortId, status: body.status },
    });
  }).catch(() => {});

  return c.json(task);
});

// Delete task
taskRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = deleteTask(id);
  if (!deleted) return c.json({ error: 'Task not found' }, 404);
  return c.json({ ok: true });
});

// ── Task Comments ──

// List comments
taskRoutes.get('/:taskId/comments', async (c) => {
  const db = c.get('db');
  const taskId = c.req.param('taskId');

  const comments = listComments(taskId);

  // Look up user display names from Postgres
  const userIds = [...new Set(comments.map(cm => cm.userId))];
  const userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of userRows) {
      userMap.set(u.id, u.displayName);
    }
  }

  const result = comments.map(comment => ({
    ...comment,
    userDisplayName: userMap.get(comment.userId) ?? null,
  }));

  return c.json(result);
});

// Add comment
taskRoutes.post('/:taskId/comments', async (c) => {
  const userId = c.get('userId');
  const taskId = c.req.param('taskId');
  const body = await c.req.json<{ content: string }>();

  if (!body.content?.trim()) {
    return c.json({ error: 'content required' }, 400);
  }

  // Verify task exists
  const task = getTask(taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const comment = addComment(taskId, userId, body.content.trim());
  return c.json(comment, 201);
});

// Delete comment (only by author)
taskRoutes.delete('/:taskId/comments/:commentId', async (c) => {
  const userId = c.get('userId');
  const commentId = c.req.param('commentId');

  const comment = getComment(commentId);
  if (!comment) return c.json({ error: 'Comment not found' }, 404);
  if (comment.userId !== userId) return c.json({ error: 'Not authorized' }, 403);

  deleteComment(commentId);
  return c.json({ ok: true });
});
