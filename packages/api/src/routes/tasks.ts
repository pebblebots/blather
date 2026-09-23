import { logAgentActivity, isAgentUser } from "./activity.js";
import { Hono } from 'hono';
import { inArray } from 'drizzle-orm';
import { users } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  listTasks,
  createTask,
  getTaskForViewer,
  getTaskByShortIdForViewer,
  updateTask,
  deleteTask,
  getTaskClaimConflict,
  canAssignTask,
  canMutateTask,
  canUseTaskChannel,
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
const VALID_PRIORITIES: TaskPriority[] = ['urgent', 'normal', 'low'];

function normalizeStatus(s: string): TaskStatus | null {
  const mapped = s.replace(/-/g, '_');
  if (!VALID_STATUSES.includes(mapped as TaskStatus)) return null;
  return mapped as TaskStatus;
}

function validatePriority(p: string): TaskPriority | null {
  if (!VALID_PRIORITIES.includes(p as TaskPriority)) return null;
  return p as TaskPriority;
}

// List tasks
taskRoutes.get('/', async (c) => {
  const db = c.get('db');
  const status = c.req.query('status');
  const priority = c.req.query('priority');
  const assignee = c.req.query('assigneeId');

  if (status) {
    const normalized = normalizeStatus(status);
    if (!normalized) return c.json({ error: 'Invalid status: ' + status + '. Valid: ' + VALID_STATUSES.join(', ') }, 400);
  }
  if (priority) {
    const validated = validatePriority(priority);
    if (!validated) return c.json({ error: 'Invalid priority: ' + priority + '. Valid: ' + VALID_PRIORITIES.join(', ') }, 400);
  }

  const result = await listTasks(db, {
    status: status ? normalizeStatus(status)! : undefined,
    priority: priority ? validatePriority(priority)! : undefined,
    assigneeId: assignee,
    viewerId: c.get('userId'),
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

  if (body.priority && !validatePriority(body.priority)) {
    return c.json({ error: 'Invalid priority: ' + body.priority + '. Valid: ' + VALID_PRIORITIES.join(', ') }, 400);
  }

  if (body.sourceChannelId && !await canUseTaskChannel(db, body.sourceChannelId, userId)) {
    return c.json({ error: 'Not authorized for source channel' }, 403);
  }
  if (!await canAssignTask(db, body.sourceChannelId ?? null, body.assigneeId ?? null)) {
    return c.json({ error: 'Invalid assignee for task scope' }, 400);
  }

  const task = await createTask(db, {
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

// Get single task (by UUID, numeric shortId, or T#N)
taskRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const raw = c.req.param('id');
  let task = null;

  // Try shortId form first if it looks numeric (with optional "T#" prefix)
  const shortMatch = raw.match(/^T?#?(\d+)$/i);
  if (shortMatch) {
    const n = Number(shortMatch[1]);
    if (Number.isFinite(n)) task = await getTaskByShortIdForViewer(db, n, userId);
    // A numeric/T# token is never a UUID. Avoid an invalid UUID database query
    // on a short-id miss; the normal not-found response below is authoritative.
    if (!task) return c.json({ error: 'Task not found' }, 404);
  }

  // Fall back to UUID lookup, applying the same visibility rule.
  if (!task) task = await getTaskForViewer(db, raw, userId);

  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
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
    completionArtifact?: string | null;
  }>();

  // Fetch current task for status comparison, without exposing tasks outside
  // the caller's visibility scope.
  const existing = await getTaskForViewer(db, id, userId);
  if (!existing) return c.json({ error: 'Task not found' }, 404);

  const updates: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    assigneeId?: string | null;
    completionArtifact?: string | null;
  } = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.priority !== undefined) {
    if (!validatePriority(body.priority)) {
      return c.json({ error: 'Invalid priority: ' + body.priority + '. Valid: ' + VALID_PRIORITIES.join(', ') }, 400);
    }
    updates.priority = body.priority;
  }
  if (body.status !== undefined) {
    const normalized = normalizeStatus(body.status);
    if (!normalized) {
      return c.json({ error: 'Invalid status: ' + body.status + '. Valid: ' + VALID_STATUSES.join(', ') }, 400);
    }
    updates.status = normalized;
  }
  if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;
  if (body.completionArtifact !== undefined) updates.completionArtifact = body.completionArtifact;

  // Check claim conflict before authorization so a visible task claimed by
  // somebody else returns the useful 409 rather than an opaque 403.
  if (updates.status === 'in_progress') {
    const conflict = await getTaskClaimConflict(db, id, userId);
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

  const operation = updates.status === 'in_progress' ? 'claim' : 'update';
  if (!await canMutateTask(db, id, userId, operation)) {
    return c.json({ error: 'Not authorized to modify task' }, 403);
  }
  if (body.assigneeId !== undefined && !await canAssignTask(db, existing.sourceChannelId, body.assigneeId)) {
    return c.json({ error: 'Invalid assignee for task scope' }, 400);
  }

  let task;
  try {
    task = await updateTask(db, id, updates, userId);
  } catch (e) {
    if (e instanceof TaskClaimConflictError) {
      return c.json({ error: 'Task already claimed', claimedById: e.claimedById }, 409);
    }
    throw e;
  }
  if (!task) return c.json({ error: 'Task not found' }, 404);

  // Status change notification
  if (updates.status && updates.status !== existing.status) {
    if (existing.sourceChannelId) {
      try {
        const { notifyStatusChange } = await import('../bots/tasks.js');
        await notifyStatusChange(db, task, existing.status, updates.status, userId, updates.completionArtifact);
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
  const db = c.get('db');
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await getTaskForViewer(db, id, userId);
  if (!existing) return c.json({ error: 'Task not found' }, 404);
  if (!await canMutateTask(db, id, userId, 'delete')) {
    return c.json({ error: 'Not authorized to delete task' }, 403);
  }
  const deleted = await deleteTask(db, id);
  if (!deleted) return c.json({ error: 'Task not found' }, 404);
  return c.json({ ok: true });
});

// ── Task Comments ──

// List comments
taskRoutes.get('/:taskId/comments', async (c) => {
  const db = c.get('db');
  const taskId = c.req.param('taskId');

  const task = await getTaskForViewer(db, taskId, c.get('userId'));
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const comments = await listComments(db, taskId);

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
  const db = c.get('db');
  const userId = c.get('userId');
  const taskId = c.req.param('taskId');
  const body = await c.req.json<{ content: string }>();

  if (!body.content?.trim()) {
    return c.json({ error: 'content required' }, 400);
  }

  // Verify task exists
  const task = await getTaskForViewer(db, taskId, c.get('userId'));
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const comment = await addComment(db, taskId, userId, body.content.trim());
  return c.json(comment, 201);
});

// Delete comment (only by author)
taskRoutes.delete('/:taskId/comments/:commentId', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const commentId = c.req.param('commentId');

  const comment = await getComment(db, commentId);
  if (!comment) return c.json({ error: 'Comment not found' }, 404);
  if (comment.userId !== userId) return c.json({ error: 'Not authorized' }, 403);
  if (!await getTaskForViewer(db, comment.taskId, userId)) {
    return c.json({ error: 'Task not found' }, 404);
  }

  await deleteComment(db, commentId);
  return c.json({ ok: true });
});
