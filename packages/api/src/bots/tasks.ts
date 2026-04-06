import { eq, and } from 'drizzle-orm';
import { users, messages, channels, channelMembers } from '@blather/db';
import type { Db } from '@blather/db';
import { emitEvent } from '../ws/events.js';
import {
  createTask,
  updateTask,
  resolveTask,
  findTaskByTitle,
  listOpenTasksWithCommentCount,
  addComment,
} from '../tasks/queries.js';

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

function formatTaskId(task: { shortId: number | null; id: string }): string {
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
  const rows = listOpenTasksWithCommentCount();

  if (rows.length === 0) {
    await postBotMessage(db, channelId, '✅ No open tasks! All clear.', threadId);
    return;
  }

  const priorityEmoji: Record<string, string> = { urgent: '🔴', normal: '🟡', low: '🟢' };
  const statusEmoji: Record<string, string> = { queued: '📋', in_progress: '🔄', done: '✅' };

  const lines = rows.map((t, i) => {
    const sid = t.shortId ? `T#${t.shortId}` : t.id.slice(0, 8);
    const comments = t.commentsCount > 0 ? ` 💬${t.commentsCount}` : '';
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
  const task = createTask({
    title,
    priority,
    creatorId: uid,
    sourceChannelId: channelId,
  });

  const sid = formatTaskId(task);
  const emoji = priority === 'urgent' ? '🔴' : priority === 'low' ? '🟢' : '🟡';
  await postBotMessage(db, channelId, `${emoji} Task created: **${title}** \`${sid}\``, threadId);
}

async function cmdDone(db: Db, channelId: string, query: string, threadId?: string | null, userId?: string) {
  if (!query) {
    await postBotMessage(db, channelId, '❌ Please specify a task: `@tasks done <T#id or title>`', threadId);
    return;
  }

  let task = resolveTask(query.trim());

  if (!task) {
    task = findTaskByTitle(query, { excludeStatus: 'done' });
  }

  if (!task) {
    await postBotMessage(db, channelId, `❌ No task found matching "${query}"`, threadId);
    return;
  }

  const prevStatus = task.status;
  const updated = updateTask(task.id, { status: 'done' });
  if (!updated) return;

  const sid = formatTaskId(updated);
  await postBotMessage(db, channelId, `✅ Done: **${updated.title}** \`${sid}\``, threadId);
  await notifyStatusChange(db, updated, prevStatus, 'done', userId);
}

async function cmdStart(db: Db, channelId: string, query: string, threadId?: string | null, userId?: string) {
  if (!query) {
    await postBotMessage(db, channelId, '❌ Please specify a task: `@tasks start <T#id or title>`', threadId);
    return;
  }

  let task = resolveTask(query.trim());
  if (!task) {
    task = findTaskByTitle(query, { requiredStatus: 'queued' });
  }

  if (!task) {
    await postBotMessage(db, channelId, `❌ No task found matching "${query}"`, threadId);
    return;
  }

  const prevStatus = task.status;
  const updated = updateTask(task.id, { status: 'in_progress', assigneeId: userId ?? null });
  if (!updated) return;

  const sid = formatTaskId(updated);
  await postBotMessage(db, channelId, `🔄 Started: **${updated.title}** \`${sid}\``, threadId);
  await notifyStatusChange(db, updated, prevStatus, 'in_progress', userId);
}

async function cmdComment(db: Db, channelId: string, args: string[], threadId?: string | null, userId?: string) {
  if (args.length < 2) {
    await postBotMessage(db, channelId, '❌ Usage: `@tasks comment <T#id> <text>`', threadId);
    return;
  }

  const task = resolveTask(args[0]);
  if (!task) {
    await postBotMessage(db, channelId, `❌ No task found matching "${args[0]}"`, threadId);
    return;
  }

  const commentText = args.slice(1).join(' ').trim();
  if (!commentText) {
    await postBotMessage(db, channelId, '❌ Comment text cannot be empty', threadId);
    return;
  }

  const commentUserId = userId ?? await ensureBotUser(db);
  addComment(task.id, commentUserId, commentText);

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
