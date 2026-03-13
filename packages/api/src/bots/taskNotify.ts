import { eq, and } from 'drizzle-orm';
import { users, messages, channels, channelMembers } from '@blather/db';
import type { Db } from '@blather/db';
import { emitEvent } from '../ws/events.js';

const BOT_EMAIL = 'tasks@system.blather';
let botUserId: string | null = null;

async function getBotUserId(db: Db): Promise<string> {
  if (botUserId) return botUserId;
  const [existing] = await db.select().from(users).where(eq(users.email, BOT_EMAIL)).limit(1);
  if (existing) { botUserId = existing.id; return botUserId; }
  throw new Error('TaskBot user not found');
}

async function ensureChannelMembership(db: Db, channelId: string, userId: string) {
  const [m] = await db.select().from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId))).limit(1);
  if (!m) await db.insert(channelMembers).values({ channelId, userId });
}

export async function postStatusNotification(db: Db, task: any, prevStatus: string, newStatus: string, userId?: string) {
  if (prevStatus === newStatus) return;
  const sourceChannelId = task.sourceChannelId || task.source_channel_id;
  if (!sourceChannelId) return;

  let displayName = 'someone';
  if (userId) {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (u) displayName = u.displayName;
  }

  const sid = task.shortId ? `T#${task.shortId}` : (task.short_id ? `T#${task.short_id}` : task.id.slice(0, 8));
  const statusLabel = newStatus === 'in_progress' ? 'in progress' : newStatus;
  const content = `📋 \`${sid}\` status: ${prevStatus} → ${statusLabel} (by ${displayName})`;

  const uid = await getBotUserId(db);
  await ensureChannelMembership(db, sourceChannelId, uid);

  const [msg] = await db.insert(messages).values({
    channelId: sourceChannelId,
    userId: uid,
    content,
    threadId: null,
    attachments: [],
  }).returning();

  const [channel] = await db.select().from(channels).where(eq(channels.id, sourceChannelId)).limit(1);
  if (channel) {
    await emitEvent(db, {
      workspaceId: channel.workspaceId,
      channelId: sourceChannelId,
      userId: uid,
      type: 'message.created',
      payload: {
        id: msg.id, channelId: msg.channelId, userId: msg.userId, content: msg.content,
        threadId: null, createdAt: msg.createdAt.toISOString(), attachments: [],
        user: { displayName: 'TaskBot', isAgent: true },
      },
    });
  }
}
