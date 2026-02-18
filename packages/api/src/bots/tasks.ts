import { eq, and, or, sql, ne } from 'drizzle-orm';
import { tasks, users, messages, channels, channelMembers, workspaceMembers } from '@blather/db';
import type { Db } from '@blather/db';
import { emitEvent } from '../ws/events.js';

const WORKSPACE_ID = 'bad75ecc-7531-4802-9928-df4e14ae8442';
const BOT_EMAIL = 'tasks@system.blather';

let botUserId: string | null = null;

async function ensureBotUser(db: Db): Promise<string> {
  if (botUserId) return botUserId;

  const [existing] = await db.select().from(users)
    .where(eq(users.email, BOT_EMAIL)).limit(1);

  if (existing) {
    botUserId = existing.id;
  } else {
    const [created] = await db.insert(users).values({
      email: BOT_EMAIL,
      displayName: 'TaskBot',
      isAgent: true,
      passwordHash: 'nologin',
    } as any).returning();
    botUserId = created.id;
    console.log('[TaskBot] Created bot user:', botUserId);
  }

  // Ensure workspace membership
  const [wsMember] = await db.select().from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, WORKSPACE_ID), eq(workspaceMembers.userId, botUserId)))
    .limit(1);
  if (!wsMember) {
    await db.insert(workspaceMembers).values({ workspaceId: WORKSPACE_ID, userId: botUserId, role: 'member' } as any);
    console.log('[TaskBot] Added to workspace');
  }

  return botUserId;
}

async function ensureChannelMembership(db: Db, channelId: string, userId: string) {
  const [m] = await db.select().from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);
  if (!m) {
    await db.insert(channelMembers).values({ channelId, userId });
  }
}

async function postBotMessage(db: Db, channelId: string, content: string, threadId?: string | null) {
  const uid = await ensureBotUser(db);
  await ensureChannelMembership(db, channelId, uid);

  const [msg] = await db.insert(messages).values({
    channelId,
    userId: uid,
    content,
    threadId: threadId ?? null,
    attachments: [],
  }).returning();

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (channel) {
    await emitEvent(db, {
      workspaceId: channel.workspaceId,
      channelId,
      userId: uid,
      type: 'message.created',
      payload: {
        id: msg.id,
        channelId: msg.channelId,
        userId: msg.userId,
        content: msg.content,
        threadId: msg.threadId,
        createdAt: msg.createdAt.toISOString(),
        attachments: [],
        user: { displayName: 'TaskBot', isAgent: true },
      },
    });
  }

  return msg;
}

export async function handleTasksCommand(db: Db, channelId: string, content: string, threadId?: string | null) {
  const raw = content.replace(/^@tasks\s*/, '').trim();
  const parts = raw.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || '';

  console.log('[TaskBot] Command:', cmd, 'Args:', parts.slice(1).join(' '));

  try {
    if (cmd === 'list' || cmd === 'ls') {
      await cmdList(db, channelId, threadId);
    } else if (cmd === 'add' || cmd === 'new') {
      await cmdAdd(db, channelId, parts.slice(1), threadId);
    } else if (cmd === 'done' || cmd === 'complete') {
      await cmdDone(db, channelId, parts.slice(1).join(' '), threadId);
    } else {
      await cmdHelp(db, channelId, threadId);
    }
  } catch (err) {
    console.error('[TaskBot] Error:', err);
    await postBotMessage(db, channelId, `❌ Error: ${(err as Error).message}`, threadId);
  }
}

async function cmdList(db: Db, channelId: string, threadId?: string | null) {
  const result = await db.select().from(tasks)
    .where(and(eq(tasks.workspaceId, WORKSPACE_ID), ne(tasks.status, 'done')))
    .orderBy(sql`CASE WHEN priority = 'urgent' THEN 0 WHEN priority = 'normal' THEN 1 ELSE 2 END, created_at DESC`);

  if (result.length === 0) {
    await postBotMessage(db, channelId, '✅ No open tasks! All clear.', threadId);
    return;
  }

  const priorityEmoji: Record<string, string> = { urgent: '🔴', normal: '🟡', low: '🟢' };
  const statusEmoji: Record<string, string> = { queued: '📋', in_progress: '🔄', done: '✅' };

  const lines = result.map((t, i) =>
    `${i + 1}. ${priorityEmoji[t.priority] || '⚪'} ${statusEmoji[t.status] || '❓'} **${t.title}** \`${t.id.slice(0, 8)}\``
  );

  await postBotMessage(db, channelId, `📋 **Open Tasks** (${result.length})\n\n${lines.join('\n')}`, threadId);
}

async function cmdAdd(db: Db, channelId: string, args: string[], threadId?: string | null) {
  let priority: 'urgent' | 'normal' | 'low' = 'normal';
  let titleParts = args;

  if (args[0]?.toLowerCase() === 'urgent') {
    priority = 'urgent';
    titleParts = args.slice(1);
  } else if (args[0]?.toLowerCase() === 'low') {
    priority = 'low';
    titleParts = args.slice(1);
  }

  const title = titleParts.join(' ').trim();
  if (!title) {
    await postBotMessage(db, channelId, '❌ Please provide a task title: `@tasks add <title>`', threadId);
    return;
  }

  const uid = await ensureBotUser(db);
  const [task] = await db.insert(tasks).values({
    workspaceId: WORKSPACE_ID,
    title,
    priority,
    creatorId: uid,
  }).returning();

  const emoji = priority === 'urgent' ? '🔴' : priority === 'low' ? '🟢' : '🟡';
  await postBotMessage(db, channelId, `${emoji} Task created: **${title}** \`${task.id.slice(0, 8)}\``, threadId);
}

async function cmdDone(db: Db, channelId: string, query: string, threadId?: string | null) {
  if (!query) {
    await postBotMessage(db, channelId, '❌ Please specify a task ID or title: `@tasks done <id or title>`', threadId);
    return;
  }

  // Try by ID prefix first, then by title fragment
  let found = await db.select().from(tasks)
    .where(and(eq(tasks.workspaceId, WORKSPACE_ID), sql`${tasks.id}::text LIKE ${query + '%'}`))
    .limit(1);

  if (found.length === 0) {
    found = await db.select().from(tasks)
      .where(and(
        eq(tasks.workspaceId, WORKSPACE_ID),
        ne(tasks.status, 'done'),
        sql`lower(${tasks.title}) LIKE ${'%' + query.toLowerCase() + '%'}`
      ))
      .limit(1);
  }

  if (found.length === 0) {
    await postBotMessage(db, channelId, `❌ No task found matching "${query}"`, threadId);
    return;
  }

  const [updated] = await db.update(tasks)
    .set({ status: 'done', updatedAt: new Date() })
    .where(eq(tasks.id, found[0].id))
    .returning();

  await postBotMessage(db, channelId, `✅ Done: **${updated.title}** \`${updated.id.slice(0, 8)}\``, threadId);
}

async function cmdHelp(db: Db, channelId: string, threadId?: string | null) {
  await postBotMessage(db, channelId, [
    '🤖 **TaskBot Commands**',
    '',
    '`@tasks list` — Show open tasks',
    '`@tasks add <title>` — Create a task',
    '`@tasks add urgent <title>` — Create urgent task',
    '`@tasks done <id or title>` — Mark task as done',
    '`@tasks` — Show this help',
  ].join('\n'), threadId);
}
