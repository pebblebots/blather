import { Hono } from 'hono';
import { eq, and, or, sql } from 'drizzle-orm';
import { workspaces, workspaceMembers, channels, channelMembers, users } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import type { CreateWorkspaceRequest, CreateChannelRequest, CreateDMRequest } from '@blather/types';
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
    allowedDomains: body.allowedDomains ?? [],
  }).returning();

  await db.insert(workspaceMembers).values({
    workspaceId: ws.id,
    userId,
    role: 'owner',
  });

  // Auto-create #general channel with is_default=true
  const [generalChannel] = await db.insert(channels).values({
    workspaceId: ws.id,
    name: 'general',
    slug: 'general',
    channelType: 'public',
    isDefault: true,
    topic: 'General discussion for the workspace',
    createdBy: userId,
  }).returning();

  // Auto-join creator to #general
  await db.insert(channelMembers).values({
    channelId: generalChannel.id,
    userId,
  });

  return c.json(ws, 201);
});

// List channels in workspace (public + private user is member of + DMs)
workspaceRoutes.get('/:id/channels', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const workspaceId = c.req.param('id');

  // Get public non-archived channels
  const publicChannels = await db.select().from(channels).where(
    and(eq(channels.workspaceId, workspaceId), eq(channels.channelType, 'public'), eq(channels.archived, false))
  );

  // Get private channels the user is a member of (non-archived)
  const privateChannelRows = await db
    .select({ channel: channels })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(
      and(
        eq(channelMembers.userId, userId),
        eq(channels.workspaceId, workspaceId),
        eq(channels.channelType, 'private'),
        eq(channels.archived, false)
      )
    );

  // Get DM channels the user is a member of
  const dmChannelRows = await db
    .select({ channel: channels })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(
      and(
        eq(channelMembers.userId, userId),
        eq(channels.workspaceId, workspaceId),
        eq(channels.channelType, 'dm')
      )
    );

  const result = [...publicChannels, ...privateChannelRows.map(r => r.channel), ...dmChannelRows.map(r => r.channel)];
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
    channelType: body.channelType ?? 'public',
    isDefault: body.isDefault ?? false,
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
      channelType: ch.channelType,
      isDefault: ch.isDefault,
      topic: ch.topic,
      createdBy: ch.createdBy,
      createdAt: ch.createdAt.toISOString(),
    },
  });

  return c.json(ch, 201);
});

// Get workspace members
workspaceRoutes.get('/:id/members', async (c) => {
  const db = c.get('db');
  const workspaceId = c.req.param('id');

  const members = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      isAgent: users.isAgent,
      avatarUrl: users.avatarUrl,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  return c.json(members);
});

// Create or get DM channel
workspaceRoutes.post('/:id/dm', async (c) => {
  const body = await c.req.json<CreateDMRequest>();
  const db = c.get('db');
  const userId = c.get('userId');
  const workspaceId = c.req.param('id');

  // Sort user IDs to ensure consistent slug
  const userIds = [userId, body.userId].sort();
  const dmSlug = `dm-${userIds.join('-')}`;

  // Try to find existing DM channel
  const existingChannels = await db
    .select()
    .from(channels)
    .where(and(
      eq(channels.workspaceId, workspaceId),
      eq(channels.slug, dmSlug),
      eq(channels.channelType, 'dm')
    ));

  if (existingChannels.length > 0) {
    return c.json(existingChannels[0]);
  }

  // Create new DM channel
  const [dmChannel] = await db.insert(channels).values({
    workspaceId,
    name: '', // DM channels have empty names
    slug: dmSlug,
    channelType: 'dm',
    isDefault: false,
    topic: null,
    createdBy: userId,
  }).returning();

  // Add both users to the channel
  await db.insert(channelMembers).values([
    { channelId: dmChannel.id, userId },
    { channelId: dmChannel.id, userId: body.userId },
  ]);

  // Emit channel.created so the other user's UI picks it up
  await emitEvent(db, {
    workspaceId,
    channelId: dmChannel.id,
    userId,
    type: 'channel.created',
    payload: {
      id: dmChannel.id,
      workspaceId,
      name: dmChannel.name,
      slug: dmChannel.slug,
      channelType: dmChannel.channelType,
      isDefault: dmChannel.isDefault,
      topic: dmChannel.topic,
      createdBy: dmChannel.createdBy,
      createdAt: dmChannel.createdAt?.toISOString?.() ?? null,
    },
  });

  return c.json(dmChannel, 201);
});

// Get unread counts per channel
workspaceRoutes.get('/:id/unread', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const workspaceId = c.req.param('id');

  const result = await db.execute(
    sql`SELECT c.id as channel_id,
           COUNT(m.id)::int as unread_count
         FROM channels c
         LEFT JOIN channel_reads cr ON cr.channel_id = c.id AND cr.user_id = ${userId}
         LEFT JOIN messages m ON m.channel_id = c.id AND (cr.last_read_at IS NULL OR m.created_at > cr.last_read_at)
         WHERE c.workspace_id = ${workspaceId}
         GROUP BY c.id
         HAVING COUNT(m.id) > 0`
  );

  const counts: Record<string, number> = {};
  for (const row of result as any[]) {
    counts[row.channel_id] = row.unread_count;
  }
  return c.json(counts);
});


// Get workspace presence
workspaceRoutes.get('/:id/presence', async (c) => {
  const workspaceId = c.req.param('id');
  const { getPresenceForWorkspace } = await import('../ws/manager.js');
  const presence = getPresenceForWorkspace(workspaceId);
  return c.json(presence);
});
