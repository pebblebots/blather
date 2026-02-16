import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { tasks, workspaceMembers } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';

export const taskRoutes = new Hono<Env>();
taskRoutes.use('*', authMiddleware);

// List tasks for a workspace
taskRoutes.get('/', async (c) => {
  const db = c.get('db');
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

  const conditions: any[] = [eq(tasks.workspaceId, workspaceId)];
  const status = c.req.query('status');
  if (status) conditions.push(eq(tasks.status, status as any));
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
  }).returning();

  return c.json(task, 201);
});

// Update task
taskRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json<{
    title?: string;
    description?: string | null;
    priority?: 'urgent' | 'normal' | 'low';
    status?: 'queued' | 'in_progress' | 'done';
    assigneeId?: string | null;
  }>();

  const updates: any = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.status !== undefined) updates.status = body.status;
  if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;

  const [task] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
  if (!task) return c.json({ error: 'Task not found' }, 404);

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
