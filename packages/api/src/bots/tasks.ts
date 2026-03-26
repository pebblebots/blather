import { eq, and, sql, ne } from 'drizzle-orm';
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

async function resolveTask(db: Db, token: string) {
  const shortMatch = token.match(/^T#?(\d+)$/i) || token.match(/^(\d+)$/);
  if (shortMatch) {
    const n = parseInt(shortMatch[1], 10);
    const found = await db.select().from(tasks)
      .where(and(eq(tasks.workspaceId, WORKSPACE_ID), sql`${tasks.shortId} = ${n}`))
      .limit(1);
    if (found.length > 0) return found[0];
  }
  const found = await db.select().from(tasks)
    .where(and(eq(tasks.workspaceId, WORKSPACE_ID), sql`${tasks.id}::text LIKE ${token + '%'}`))
    .limit(1);
  if (found.length > 0) return found[0];
  return null;
}

function formatTaskId(task: any): string {
  return task.shortId ? `T#${task.shortId}` : task.id.slice(0, 8);
}

export async function handleTasksCommand(db: Db, channelId: string, content: string, threadId?: string | null, userId?: string) {
  const raw = content.replace(/^@tasks\s*/, '').trim();
  const parts = raw.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || '';

  console.log('[TaskBot] Command:', cmd, 'Args:', parts.slice(1).join(' '));

  try {
    if (cmd === 'list' || cmd === 'ls') {
      await cmdList(db, channelId, threadId);
    } else if (cmd === 'add' || cmd === 'new' || cmd === 'create') {
      await cmdAdd(db, channelId, parts.slice(1), threadId);
    } else if (cmd === 'done' || cmd === 'complete') {
      await cmdDone(db, channelId, parts.slice(1).join(' '), threadId, userId);
    } else if (cmd === 'start' || cmd === 'claim') {
      await cmdStart(db, channelId, parts.slice(1).join(' '), threadId, userId);
    } else if (cmd === 'comment') {
      await cmdComment(db, channelId, parts.slice(1), threadId, userId);
    } else {
      await cmdHelp(db, channelId, threadId);
    }
  } catch (err) {
    console.error('[TaskBot] Error:', err);
    await postBotMessage(db, channelId, `❌ Error: ${(err as Error).message}`, threadId);
  }
}

async function cmdList(db: Db, channelId: string, threadId?: string | null) {
  const result = await db.execute(sql`
    SELECT t.*, COALESCE(c.cnt, 0) AS comments_count
    FROM tasks t
    LEFT JOIN (SELECT task_id, count(*) AS cnt FROM task_comments GROUP BY task_id) c ON c.task_id = t.id
    WHERE t.workspace_id = ${WORKSPACE_ID} AND t.status != 'done'
    ORDER BY CASE WHEN t.priority = 'urgent' THEN 0 WHEN t.priority = 'normal' THEN 1 ELSE 2 END, t.created_at DESC
  `);

  const rows: any[] = (result as any).rows || result as any;

  if (rows.length === 0) {
    await postBotMessage(db, channelId, '✅ No open tasks! All clear.', threadId);
    return;
  }

  const priorityEmoji: Record<string, string> = { urgent: '🔴', normal: '🟡', low: '🟢' };
  const statusEmoji: Record<string, string> = { queued: '📋', in_progress: '🔄', done: '✅' };

  const lines = rows.map((t: any, i: number) => {
    const sid = t.short_id ? `T#${t.short_id}` : t.id.slice(0, 8);
    const comments = parseInt(t.comments_count) > 0 ? ` 💬${t.comments_count}` : '';
    return `${i + 1}. ${priorityEmoji[t.priority] || '⚪'} ${statusEmoji[t.status] || '❓'} **${t.title}** \`${sid}\`${comments}`;
  });

  await postBotMessage(db, channelId, `📋 **Open Tasks** (${rows.length})\n\n${lines.join('\n')}`, threadId);
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
    sourceChannelId: channelId,
  } as any).returning();

  const sid = (task as any).shortId ? `T#${(task as any).shortId}` : task.id.slice(0, 8);
  const emoji = priority === 'urgent' ? '🔴' : priority === 'low' ? '🟢' : '🟡';
  await postBotMessage(db, channelId, `${emoji} Task created: **${title}** \`${sid}\``, threadId);
}

async function cmdDone(db: Db, channelId: string, query: string, threadId?: string | null, userId?: string) {
  if (!query) {
    await postBotMessage(db, channelId, '❌ Please specify a task: `@tasks done <T#id or title>`', threadId);
    return;
  }

  let task = await resolveTask(db, query.trim());

  if (!task) {
    const found = await db.select().from(tasks)
      .where(and(
        eq(tasks.workspaceId, WORKSPACE_ID),
        ne(tasks.status, 'done'),
        sql`lower(${tasks.title}) LIKE ${'%' + query.toLowerCase() + '%'}`
      ))
      .limit(1);
    if (found.length > 0) task = found[0];
  }

  if (!task) {
    await postBotMessage(db, channelId, `❌ No task found matching "${query}"`, threadId);
    return;
  }

  const prevStatus = task.status;
  const [updated] = await db.update(tasks)
    .set({ status: 'done', updatedAt: new Date() })
    .where(eq(tasks.id, task.id))
    .returning();

  const sid = formatTaskId(updated);
  await postBotMessage(db, channelId, `✅ Done: **${updated.title}** \`${sid}\``, threadId);
  await notifyStatusChange(db, updated, prevStatus, 'done', userId);
}

async function cmdStart(db: Db, channelId: string, query: string, threadId?: string | null, userId?: string) {
  if (!query) {
    await postBotMessage(db, channelId, '❌ Please specify a task: `@tasks start <T#id or title>`', threadId);
    return;
  }

  let task = await resolveTask(db, query.trim());
  if (!task) {
    const found = await db.select().from(tasks)
      .where(and(eq(tasks.workspaceId, WORKSPACE_ID), eq(tasks.status, 'queued'),
        sql`lower(${tasks.title}) LIKE ${'%' + query.toLowerCase() + '%'}`))
      .limit(1);
    if (found.length > 0) task = found[0];
  }

  if (!task) {
    await postBotMessage(db, channelId, `❌ No task found matching "${query}"`, threadId);
    return;
  }

  const prevStatus = task.status;
  const [updated] = await db.update(tasks)
    .set({ status: 'in_progress' as any, updatedAt: new Date(), assigneeId: userId || null })
    .where(eq(tasks.id, task.id))
    .returning();

  const sid = formatTaskId(updated);
  await postBotMessage(db, channelId, `🔄 Started: **${updated.title}** \`${sid}\``, threadId);
  await notifyStatusChange(db, updated, prevStatus, 'in_progress', userId);
}

async function cmdComment(db: Db, channelId: string, args: string[], threadId?: string | null, userId?: string) {
  if (args.length < 2) {
    await postBotMessage(db, channelId, '❌ Usage: `@tasks comment <T#id> <text>`', threadId);
    return;
  }

  const task = await resolveTask(db, args[0]);
  if (!task) {
    await postBotMessage(db, channelId, `❌ No task found matching "${args[0]}"`, threadId);
    return;
  }

  const commentText = args.slice(1).join(' ').trim();
  if (!commentText) {
    await postBotMessage(db, channelId, '❌ Comment text cannot be empty', threadId);
    return;
  }

  const commentUserId = userId || await ensureBotUser(db);
  await db.execute(sql`INSERT INTO task_comments (task_id, user_id, content) VALUES (${task.id}, ${commentUserId}, ${commentText})`);

  const sid = formatTaskId(task);
  await postBotMessage(db, channelId, `💬 Comment added to **${task.title}** \`${sid}\``, threadId);
}

export async function notifyStatusChange(db: Db, task: any, prevStatus: string, newStatus: string, userId?: string) {
  if (prevStatus === newStatus) return;
  const sourceChannelId = task.sourceChannelId || task.source_channel_id;
  if (!sourceChannelId) return;

  let displayName = 'someone';
  if (userId) {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (u) displayName = u.displayName;
  }

  const sid = formatTaskId(task);
  const statusLabel = newStatus === 'in_progress' ? 'in progress' : newStatus;
  const content = `📢 Task \`${sid}\` marked as **${statusLabel}** by @${displayName}`;
  await postBotMessage(db, sourceChannelId, content);
}

async function cmdHelp(db: Db, channelId: string, threadId?: string | null) {
  await postBotMessage(db, channelId, [
    '🤖 **TaskBot Commands**',
    '',
    '`@tasks list` — Show open tasks',
    '`@tasks add <title>` — Create a task',
    '`@tasks add urgent <title>` — Create urgent task',
    '`@tasks done <T#id or title>` — Mark task as done',
    '`@tasks start <T#id or title>` — Mark task as in progress',
    '`@tasks comment <T#id> <text>` — Add a comment to a task',
    '`@tasks` — Show this help',
  ].join('\n'), threadId);
}
