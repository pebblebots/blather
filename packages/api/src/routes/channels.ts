import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { messages, reactions, channels, channelMembers } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitEvent } from '../ws/events.js';

export const channelRoutes = new Hono<Env>();
channelRoutes.use('*', authMiddleware);

// List messages in channel
channelRoutes.get('/:id/messages', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  // Check access for private/dm channels
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: 'Channel not found' }, 404);

  if (channel.channelType === 'dm' || channel.channelType === 'private') {
    const [membership] = await db.select().from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not a member of this channel' }, 403);
  }

  const result = await db.select().from(messages)
    .where(eq(messages.channelId, channelId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return c.json(result);
});

// Post message to channel
channelRoutes.post('/:id/messages', async (c) => {
  const db = c.get('db');
  const channelId = c.req.param('id');
  const userId = c.get('userId');
  const body = await c.req.json<{ content: string; threadId?: string }>();

  // Look up channel
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: 'Channel not found' }, 404);

  // Check membership for private/dm channels
  if (channel.channelType === 'dm' || channel.channelType === 'private') {
    const [membership] = await db.select().from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not a member of this channel' }, 403);
  }

  const [msg] = await db.insert(messages).values({
    channelId,
    userId,
    content: body.content,
    threadId: body.threadId ?? null,
  }).returning();

  await emitEvent(db, {
    workspaceId: channel.workspaceId,
    channelId,
    userId,
    type: 'message.created',
    payload: {
      id: msg.id,
      channelId: msg.channelId,
      userId: msg.userId,
      content: msg.content,
      threadId: msg.threadId,
      createdAt: msg.createdAt.toISOString(),
    },
  });

  return c.json(msg, 201);
});

// Send typing indicator
channelRoutes.post('/:id/typing', async (c) => {
  const db = c.get('db');
  const channelId = c.req.param('id');
  const userId = c.get('userId');

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: 'Channel not found' }, 404);

  if (channel.channelType === 'dm' || channel.channelType === 'private') {
    const [membership] = await db.select().from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not a member of this channel' }, 403);
  }

  const { publishEphemeralEvent } = await import('../ws/manager.js');
  await publishEphemeralEvent(channel.workspaceId, channelId, {
    type: 'typing.started',
    channel_id: channelId,
    data: { userId, channelId },
  });

  return c.json({ ok: true });
});

// Add reaction to message
channelRoutes.post('/:channelId/messages/:messageId/reactions', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('channelId');
  const messageId = c.req.param('messageId');
  const body = await c.req.json<{ emoji: string }>();

  const [reaction] = await db.insert(reactions).values({
    messageId,
    userId,
    emoji: body.emoji,
  }).returning();

  // Look up channel to get workspaceId
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (channel) {
    await emitEvent(db, {
      workspaceId: channel.workspaceId,
      channelId,
      userId,
      type: 'reaction.added',
      payload: {
        id: reaction.id,
        messageId,
        userId,
        emoji: body.emoji,
        createdAt: reaction.createdAt.toISOString(),
      },
    });
  }

  return c.json(reaction, 201);
});

// Mark channel as read
channelRoutes.post('/:id/read', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('id');

  await db.execute(
    sql`INSERT INTO channel_reads (channel_id, user_id, last_read_at)
         VALUES (${channelId}, ${userId}, NOW())
         ON CONFLICT (channel_id, user_id)
         DO UPDATE SET last_read_at = NOW()`
  );

  return c.json({ ok: true });
});
