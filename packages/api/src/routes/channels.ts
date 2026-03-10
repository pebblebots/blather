import { onMessageCreated, isHuddleChannel } from "../huddle/orchestrator.js";
import { Hono } from 'hono';
import { eq, and, desc, gt, lt, sql } from 'drizzle-orm';
import { messages, reactions, channels, channelMembers, channelReads, events, users } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitEvent } from '../ws/events.js';

import { handleTasksCommand } from '../bots/tasks.js';
import { handleIncidentCommand } from '../bots/incidents.js';
export const channelRoutes = new Hono<Env>();
channelRoutes.use('*', authMiddleware);

// List messages in channel
channelRoutes.get('/:id/messages', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const after = c.req.query('after');
  const before = c.req.query('before');
  const around = c.req.query('around');

  // Check access for private/dm channels
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: 'Channel not found' }, 404);

  if (channel.channelType === 'dm' || channel.channelType === 'private') {
    const [membership] = await db.select().from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not a member of this channel' }, 403);
  }

  const conditions: any[] = [eq(messages.channelId, channelId)];
  if (after) {
    conditions.push(gt(messages.createdAt, new Date(after)));
  }
  if (before) {
    conditions.push(lt(messages.createdAt, new Date(before)));
  }

  // Only fetch top-level messages (not thread replies)
  conditions.push(sql`${messages.threadId} IS NULL`);

  // "around" query: fetch messages surrounding a specific message ID
  if (around) {
    const { users } = await import('@blather/db');
    // Get the target message's timestamp
    const [target] = await db.select({ createdAt: messages.createdAt }).from(messages).where(eq(messages.id, around)).limit(1);
    if (!target) return c.json({ error: 'Message not found' }, 404);
    const halfLimit = Math.floor(limit / 2);
    // Fetch messages before and after (inclusive of target)
    const beforeMsgs = await db.select({
      id: messages.id, channelId: messages.channelId, userId: messages.userId,
      content: messages.content, threadId: messages.threadId,
      createdAt: messages.createdAt, updatedAt: messages.updatedAt,
      attachments: messages.attachments,
      userName: users.displayName, userIsAgent: users.isAgent,
    }).from(messages).innerJoin(users, eq(messages.userId, users.id))
      .where(and(eq(messages.channelId, channelId), sql`${messages.threadId} IS NULL`, sql`${messages.createdAt} <= ${target.createdAt.toISOString()}`))
      .orderBy(sql`${messages.createdAt} DESC`).limit(halfLimit + 1);
    const afterMsgs = await db.select({
      id: messages.id, channelId: messages.channelId, userId: messages.userId,
      content: messages.content, threadId: messages.threadId,
      createdAt: messages.createdAt, updatedAt: messages.updatedAt,
      attachments: messages.attachments,
      userName: users.displayName, userIsAgent: users.isAgent,
    }).from(messages).innerJoin(users, eq(messages.userId, users.id))
      .where(and(eq(messages.channelId, channelId), sql`${messages.threadId} IS NULL`, sql`${messages.createdAt} > ${target.createdAt.toISOString()}`))
      .orderBy(messages.createdAt).limit(halfLimit);
    // Merge, dedupe, sort
    const allMsgs = [...beforeMsgs.reverse(), ...afterMsgs];
    const seen = new Set<string>();
    const deduped = allMsgs.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
    return c.json(deduped.map(m => ({
      ...m, user: { displayName: m.userName, isAgent: m.userIsAgent },
      userName: undefined, userIsAgent: undefined,
      attachments: m.attachments || [],
    })));
  }

  const { users } = await import('@blather/db');

  // Subquery for reply counts
  const replyCountSq = db
    .select({ parentId: messages.threadId, count: sql<number>`count(*)::int`.as('count') })
    .from(messages)
    .where(sql`${messages.threadId} IS NOT NULL`)
    .groupBy(messages.threadId)
    .as('rc');

  const result = await db.select({
    id: messages.id,
    channelId: messages.channelId,
    userId: messages.userId,
    content: messages.content,
    threadId: messages.threadId,
    createdAt: messages.createdAt,
    updatedAt: messages.updatedAt,
    attachments: messages.attachments,
    replyCount: sql<number>`coalesce(${replyCountSq.count}, 0)`.as('reply_count'),
    user: {
      displayName: users.displayName,
      isAgent: users.isAgent,
    },
  }).from(messages)
    .innerJoin(users, eq(messages.userId, users.id))
    .leftJoin(replyCountSq, eq(messages.id, replyCountSq.parentId))
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return c.json(result);
});

// Detect raw API error messages that should never be broadcast
const API_ERROR_PATTERN = /\b(429|500|502|503)\b.*\b(rate[_ ]?limit|quota|error|exceeded|overloaded)\b|\b(rate[_ ]?limit[_ ]?error|rate[_ ]?limit[_ ]?exceeded|quota[_ ]?exceeded|over[_ ]?quota|internal[_ ]?server[_ ]?error|anthropic|openai)\b.*\b(429|500|502|503|error|exceeded)\b|\bHTTP\s*(4\d\d|5\d\d)\b|\b(rate_limit_error|quota_exceeded|insufficient_quota|server_error|overloaded_error)\b|\bAPI\s+rate\s+limit\b|\brate\s+limit\s+reached\b/i;

function looksLikeApiError(content: string): boolean {
  return API_ERROR_PATTERN.test(content);
}

// Post message to channel
channelRoutes.post('/:id/messages', async (c) => {
  const db = c.get('db');
  const channelId = c.req.param('id');
  const userId = c.get('userId');
  const body = await c.req.json<{ content: string; threadId?: string; attachments?: any[] }>();

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

  // Reject messages that look like raw API errors (prevents error feedback loops)
  if (looksLikeApiError(body.content)) {
    console.warn(`[error-filter] Rejected API error message from user=${userId} channel=${channelId}: ${body.content.slice(0, 200)}`);
    return c.json({ error: 'Message rejected: appears to be a raw API error. These should be handled by the sender, not posted to chat.' }, 422);
  }

  const [msg] = await db.insert(messages).values({
    channelId,
    userId,
    content: body.content,
    threadId: body.threadId ?? null,
    attachments: body.attachments || [],
  }).returning();

  // Get user info for the payload
  const { users: usersTable } = await import('@blather/db');
  const [msgUser] = await db.select({ displayName: usersTable.displayName, isAgent: usersTable.isAgent }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

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
      attachments: msg.attachments || [],
      user: msgUser ? { displayName: msgUser.displayName, isAgent: msgUser.isAgent } : undefined,
    },
  });

  // If this is a thread reply, emit thread.updated so clients can update reply counts
  if (msg.threadId) {
    const [replyCountResult] = await db.select({ count: sql<number>`count(*)::int` }).from(messages).where(eq(messages.threadId, msg.threadId));
    await emitEvent(db, {
      workspaceId: channel.workspaceId,
      channelId,
      userId,
      type: 'thread.updated' as any,
      payload: {
        parentMessageId: msg.threadId,
        channelId,
        replyCount: replyCountResult?.count || 0,
        latestReply: {
          id: msg.id,
          userId: msg.userId,
          content: msg.content,
          createdAt: msg.createdAt.toISOString(),
        },
      },
    });
  }

  // Fire-and-forget: ingest message for agent memory (only human messages)
  if (!msgUser?.isAgent) {
    try {
      const members = await db
        .select({ userId: channelMembers.userId, isAgent: usersTable.isAgent })
        .from(channelMembers)
        .innerJoin(usersTable, eq(channelMembers.userId, usersTable.id))
        .where(and(eq(channelMembers.channelId, channelId), eq(usersTable.isAgent, true)));
      for (const agent of members) {
        fetch("http://localhost:3002/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: agent.userId,
            text: body.content,
            metadata: { channelId, messageId: msg.id, userId, timestamp: new Date().toISOString() },
          }),
        }).catch(() => {});
      }
    } catch {}
  }

  // Huddle orchestrator hook
  if (isHuddleChannel(channelId)) {
    const [msgAuthor] = await db.select({ voice: users.voice, isAgent: users.isAgent, displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
    onMessageCreated(channelId, {
      id: msg.id,
      userId,
      content: body.content,
      isAgent: msgAuthor?.isAgent || false,
      voice: msgAuthor?.voice,
      displayName: msgAuthor?.displayName,
    });
  }
  // @tasks bot handler
  if (body.content.trim().startsWith("@tasks")) {
    handleTasksCommand(db, channelId, body.content.trim(), body.threadId ?? null).catch((err) => console.error("[TaskBot] Error:", err));
  }
  // @incident bot handler
  if (body.content.trim().startsWith("@incident")) {
    handleIncidentCommand(db, channelId, body.content.trim(), body.threadId ?? null).catch((err) => console.error("[IncidentBot] Error:", err));
  

  }
  return c.json(msg, 201);
});

// Get replies for a message thread
channelRoutes.get('/:channelId/messages/:messageId/replies', async (c) => {
  const db = c.get('db');
  const channelId = c.req.param('channelId');
  const messageId = c.req.param('messageId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const after = c.req.query('after');
  const before = c.req.query('before');
  const around = c.req.query('around');

  const { users } = await import('@blather/db');

  const conditions: any[] = [eq(messages.threadId, messageId)];
  if (after) conditions.push(gt(messages.createdAt, new Date(after)));
  if (before) conditions.push(lt(messages.createdAt, new Date(before)));

  const result = await db.select({
    id: messages.id,
    channelId: messages.channelId,
    userId: messages.userId,
    content: messages.content,
    threadId: messages.threadId,
    createdAt: messages.createdAt,
    updatedAt: messages.updatedAt,
    attachments: messages.attachments,
    user: {
      displayName: users.displayName,
      isAgent: users.isAgent,
    },
  }).from(messages)
    .innerJoin(users, eq(messages.userId, users.id))
    .where(and(...conditions))
    .orderBy(messages.createdAt)
    .limit(limit);

  return c.json(result);
});

// Send typing indicator (in-memory state, DB only on cache miss)
channelRoutes.post('/:id/typing', async (c) => {
  const channelId = c.req.param('id');
  const userId = c.get('userId');

  const { markTyping, getCachedChannel, setCachedChannel, getCachedUser, setCachedUser, getCachedMembership, setCachedMembership } = await import('../state/typingState.js');

  // Channel lookup — cache first
  let chan = getCachedChannel(channelId);
  if (!chan) {
    const db = c.get('db');
    const [row] = await db.select({ workspaceId: channels.workspaceId, channelType: channels.channelType }).from(channels).where(eq(channels.id, channelId)).limit(1);
    if (!row) return c.json({ error: 'Channel not found' }, 404);
    chan = row;
    setCachedChannel(channelId, chan);
  }

  // Membership check for private/dm — cache first
  if (chan.channelType === 'dm' || chan.channelType === 'private') {
    let isMember = getCachedMembership(channelId, userId);
    if (isMember === undefined) {
      const db = c.get('db');
      const [membership] = await db.select().from(channelMembers)
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
        .limit(1);
      isMember = !!membership;
      setCachedMembership(channelId, userId, isMember);
    }
    if (!isMember) return c.json({ error: 'Not a member of this channel' }, 403);
  }

  // User info — cache first
  let typingUser = getCachedUser(userId);
  if (!typingUser) {
    const db = c.get('db');
    const [row] = await db.select({ displayName: users.displayName, isAgent: users.isAgent }).from(users).where(eq(users.id, userId)).limit(1);
    if (row) {
      typingUser = row;
      setCachedUser(userId, row);
    }
  }

  markTyping(channelId, userId);

  const { publishEphemeralEvent } = await import('../ws/manager.js');
  await publishEphemeralEvent(chan.workspaceId, channelId, {
    type: 'typing.started',
    channel_id: channelId,
    data: { userId, channelId, user: typingUser ? { displayName: typingUser.displayName, isAgent: typingUser.isAgent } : undefined },
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


// Invite user to channel (only existing members can invite)
channelRoutes.post('/:id/members', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('id');
  const body = await c.req.json<{ userId: string }>();

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: 'Channel not found' }, 404);

  // Only members can invite
  const [membership] = await db.select().from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);
  if (!membership) return c.json({ error: 'You are not a member of this channel' }, 403);

  // Check if target already a member
  const [existing] = await db.select().from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, body.userId)))
    .limit(1);
  if (existing) return c.json({ error: 'User is already a member' }, 409);

  await db.insert(channelMembers).values({ channelId, userId: body.userId });

  await emitEvent(db, {
    workspaceId: channel.workspaceId,
    channelId,
    userId,
    type: 'channel.created',
    payload: { channelId, invitedUserId: body.userId },
  });

  return c.json({ ok: true }, 201);
});

// Archive channel
channelRoutes.patch('/:id/archive', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('id');

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: 'Channel not found' }, 404);
  if (channel.isDefault) return c.json({ error: 'Cannot archive the default channel' }, 400);

  // Only members can archive
  const [membership] = await db.select().from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);
  if (!membership) return c.json({ error: 'Not a member of this channel' }, 403);

  const [updated] = await db.update(channels).set({ archived: true }).where(eq(channels.id, channelId)).returning();

  await emitEvent(db, {
    workspaceId: channel.workspaceId,
    channelId,
    userId,
    type: 'channel.archived',
    payload: { id: channelId },
  });

  return c.json(updated);
});

// Get channel members
channelRoutes.get('/:id/members', async (c) => {
  const db = c.get('db');
  const channelId = c.req.param('id');

  const { users } = await import('@blather/db');
  const members = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(channelMembers)
    .innerJoin(users, eq(channelMembers.userId, users.id))
    .where(eq(channelMembers.channelId, channelId));

  return c.json(members);
});

// Delete channel
channelRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('id');

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: 'Channel not found' }, 404);

  // Emit event before deleting (channel must still exist for FK)
  await emitEvent(db, {
    workspaceId: channel.workspaceId,
    channelId,
    userId,
    type: 'channel.deleted',
    payload: { id: channelId },
  });

  // Delete dependent rows then channel
  await db.delete(channelReads).where(eq(channelReads.channelId, channelId));
  await db.delete(channelMembers).where(eq(channelMembers.channelId, channelId));
  const channelMessages = await db.select({ id: messages.id }).from(messages).where(eq(messages.channelId, channelId));
  if (channelMessages.length > 0) {
    const msgIds = channelMessages.map(m => m.id);
    for (const msgId of msgIds) {
      await db.delete(reactions).where(eq(reactions.messageId, msgId));
    }
  }
  await db.delete(messages).where(eq(messages.channelId, channelId));
  await db.delete(events).where(eq(events.channelId, channelId));
  await db.delete(channels).where(eq(channels.id, channelId));

  return c.json({ ok: true });
});

// Edit message (only author can edit)
channelRoutes.patch('/:channelId/messages/:messageId', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('channelId');
  const messageId = c.req.param('messageId');
  const body = await c.req.json<{ content: string }>();

  if (!body.content || !body.content.trim()) {
    return c.json({ error: 'Content cannot be empty' }, 400);
  }

  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg) return c.json({ error: 'Message not found' }, 404);
  if (msg.userId !== userId) return c.json({ error: 'You can only edit your own messages' }, 403);
  if (msg.channelId !== channelId) return c.json({ error: 'Message does not belong to this channel' }, 400);

  const [updated] = await db.update(messages)
    .set({ content: body.content, updatedAt: new Date() })
    .where(eq(messages.id, messageId))
    .returning();

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (channel) {
    await emitEvent(db, {
      workspaceId: channel.workspaceId,
      channelId,
      userId,
      type: 'message.updated',
      payload: {
        id: updated.id,
        channelId: updated.channelId,
        userId: updated.userId,
        content: updated.content,
        threadId: updated.threadId,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        attachments: updated.attachments || [],
      },
    });
  }

  return c.json(updated);
});

// Delete message (only author can delete)
channelRoutes.delete('/:channelId/messages/:messageId', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('channelId');
  const messageId = c.req.param('messageId');

  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg) return c.json({ error: 'Message not found' }, 404);
  if (msg.userId !== userId) return c.json({ error: 'You can only delete your own messages' }, 403);
  if (msg.channelId !== channelId) return c.json({ error: 'Message does not belong to this channel' }, 400);

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);

  // Delete reactions first
  await db.delete(reactions).where(eq(reactions.messageId, messageId));
  await db.delete(messages).where(eq(messages.id, messageId));

  if (channel) {
    await emitEvent(db, {
      workspaceId: channel.workspaceId,
      channelId,
      userId,
      type: 'message.deleted',
      payload: {
        id: messageId,
        channelId,
        userId,
      },
    });
  }

  return c.json({ ok: true });
});

// Delete/toggle reaction
channelRoutes.delete('/:channelId/messages/:messageId/reactions', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const channelId = c.req.param('channelId');
  const messageId = c.req.param('messageId');
  const body = await c.req.json<{ emoji: string }>();

  const [existing] = await db.select().from(reactions)
    .where(and(
      eq(reactions.messageId, messageId),
      eq(reactions.userId, userId),
      eq(reactions.emoji, body.emoji),
    )).limit(1);

  if (!existing) return c.json({ ok: true });

  await db.delete(reactions).where(eq(reactions.id, existing.id));

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (channel) {
    await emitEvent(db, {
      workspaceId: channel.workspaceId,
      channelId,
      userId,
      type: 'reaction.removed' as any,
      payload: {
        id: existing.id,
        messageId,
        userId,
        emoji: body.emoji,
      },
    });
  }

  return c.json({ ok: true });
});

// Get reactions for a message
channelRoutes.get('/:channelId/messages/:messageId/reactions', async (c) => {
  const db = c.get('db');
  const messageId = c.req.param('messageId');

  const result = await db.select().from(reactions)
    .where(eq(reactions.messageId, messageId));

  return c.json(result);
});
