import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { workspaces, workspaceMembers, channels, channelMembers } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import type { CreateWorkspaceRequest, CreateChannelRequest } from '@blather/types';
import { emitEvent } from '../ws/events.js';

export const workspaceRoutes = new Hono<Env>();
workspaceRoutes.use('*', authMiddleware);

// List workspaces for current user
workspaceRoutes.get('/', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');

  const memberships = await db.select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  if (memberships.length === 0) return c.json([]);

  const ids = memberships.map((m) => m.workspaceId);
  const result = await db.select().from(workspaces);
  return c.json(result.filter((w) => ids.includes(w.id)));
});

// Create workspace
workspaceRoutes.post('/', async (c) => {
  const body = await c.req.json<CreateWorkspaceRequest>();
  const db = c.get('db');
  const userId = c.get('userId');

  const [ws] = await db.insert(workspaces).values({
    name: body.name,
    slug: body.slug,
  }).returning();

  await db.insert(workspaceMembers).values({
    workspaceId: ws.id,
    userId,
    role: 'owner',
  });

  return c.json(ws, 201);
});

// List channels in workspace
workspaceRoutes.get('/:id/channels', async (c) => {
  const db = c.get('db');
  const workspaceId = c.req.param('id');

  const result = await db.select().from(channels).where(eq(channels.workspaceId, workspaceId));
  return c.json(result);
});

// Create channel in workspace
workspaceRoutes.post('/:id/channels', async (c) => {
  const body = await c.req.json<CreateChannelRequest>();
  const db = c.get('db');
  const userId = c.get('userId');
  const workspaceId = c.req.param('id');

  const [ch] = await db.insert(channels).values({
    workspaceId,
    name: body.name,
    slug: body.slug,
    isPrivate: body.isPrivate ?? false,
    topic: body.topic ?? null,
    createdBy: userId,
  }).returning();

  // Auto-join creator
  await db.insert(channelMembers).values({ channelId: ch.id, userId });

  await emitEvent(db, {
    workspaceId,
    channelId: ch.id,
    userId,
    type: 'channel.created',
    payload: {
      id: ch.id,
      name: ch.name,
      slug: ch.slug,
      isPrivate: ch.isPrivate,
      topic: ch.topic,
      createdBy: ch.createdBy,
      createdAt: ch.createdAt.toISOString(),
    },
  });

  return c.json(ch, 201);
});
