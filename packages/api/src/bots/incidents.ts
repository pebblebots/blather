import { eq, and, sql, ne } from 'drizzle-orm';
import { incidents, users, messages, channels, channelMembers } from '@blather/db';
import type { Db } from '@blather/db';
import { emitEvent } from '../ws/events.js';

const BOT_EMAIL = 'incidents@system.blather';

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
      displayName: '🚨 IncidentBot',
      isAgent: true,
      passwordHash: 'nologin',
    } as any).returning();
    botUserId = created.id;
    console.log('[IncidentBot] Created bot user:', botUserId);
  }

  return botUserId;
}

async function ensureChannelMembership(db: Db, channelId: string, userId: string) {
  const [m] = await db.select().from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);
  if (!m) {
    await db.insert(channelMembers).values({ channelId, userId }).onConflictDoNothing();
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
        user: { displayName: '🚨 IncidentBot', isAgent: true },
      },
    });
  }

  return msg;
}

export async function handleIncidentCommand(db: Db, channelId: string, content: string, threadId?: string | null) {
  const raw = content.replace(/^@incident\s*/, '').trim();
  const parts = raw.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || '';

  console.log('[IncidentBot] Command:', cmd, 'Args:', parts.slice(1).join(' '));

  try {
    if (cmd === 'list' || cmd === 'ls') {
      await cmdList(db, channelId, threadId);
    } else if (cmd === 'open' || cmd === 'create') {
      await cmdOpen(db, channelId, parts.slice(1), threadId);
    } else if (cmd === 'ack' || cmd === 'acknowledge') {
      await cmdAck(db, channelId, parts.slice(1).join(' '), threadId);
    } else if (cmd === 'resolve' || cmd === 'close') {
      await cmdResolve(db, channelId, parts.slice(1), threadId);
    } else if (cmd === 'info' || cmd === 'show') {
      await cmdInfo(db, channelId, parts.slice(1).join(' '), threadId);
    } else {
      await cmdHelp(db, channelId, threadId);
    }
  } catch (err) {
    console.error('[IncidentBot] Error:', err);
    await postBotMessage(db, channelId, `❌ Error: ${(err as Error).message}`, threadId);
  }
}

async function cmdList(db: Db, channelId: string, threadId?: string | null) {
  const result = await db.select().from(incidents)
    .where(and(ne(incidents.status, 'resolved')))
    .orderBy(sql`CASE WHEN ${incidents.severity} = 'critical' THEN 1 WHEN ${incidents.severity} = 'warning' THEN 2 ELSE 3 END, ${incidents.createdAt} DESC`);

  if (result.length === 0) {
    await postBotMessage(db, channelId, '✅ No open incidents', threadId);
    return;
  }

  const items = result.map(inc => {
    const emoji = inc.severity === 'critical' ? '🔴' : inc.severity === 'warning' ? '🟡' : '🟢';
    const status = inc.status === 'open' ? '🆕' : '✋';
    return `${emoji}${status} **${inc.title}** \`${inc.id.slice(0, 8)}\``;
  });

  await postBotMessage(db, channelId, [
    '🚨 **Open Incidents**',
    '',
    ...items
  ].join('\n'), threadId);
}

async function cmdOpen(db: Db, channelId: string, args: string[], threadId?: string | null) {
  if (args.length === 0) {
    await postBotMessage(db, channelId, '❌ Please specify a title: `@incident open [critical|warning|info] <title>`', threadId);
    return;
  }

  let severity: 'critical' | 'warning' | 'info' = 'warning';
  let title = args.join(' ');

  // Check if first arg is severity
  if (['critical', 'warning', 'info'].includes(args[0].toLowerCase())) {
    severity = args[0].toLowerCase() as any;
    title = args.slice(1).join(' ');
  }

  if (!title) {
    await postBotMessage(db, channelId, '❌ Please specify a title after severity', threadId);
    return;
  }

  const uid = await ensureBotUser(db);
  const [incident] = await db.insert(incidents).values({
    title,
    severity,
    openedBy: uid,
    channelId,
  }).returning();

  const emoji = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : '🟢';
  await postBotMessage(db, channelId, `${emoji} **Incident opened:** ${title}\n\`${incident.id.slice(0, 8)}\` • ${severity} • ${new Date().toLocaleString()}`, threadId);
}

async function cmdAck(db: Db, channelId: string, query: string, threadId?: string | null) {
  if (!query) {
    await postBotMessage(db, channelId, '❌ Please specify an incident ID: `@incident ack <id-prefix>`', threadId);
    return;
  }

  const found = await db.select().from(incidents)
    .where(and(
      eq(incidents.status, 'open'),
      sql`${incidents.id}::text LIKE ${query + '%'}`
    ))
    .limit(1);

  if (found.length === 0) {
    await postBotMessage(db, channelId, `❌ No open incident found with ID starting with "${query}"`, threadId);
    return;
  }

  const uid = await ensureBotUser(db);
  const [updated] = await db.update(incidents)
    .set({ status: 'acked', ackedBy: uid, ackedAt: new Date(), updatedAt: new Date() })
    .where(eq(incidents.id, found[0].id))
    .returning();

  await postBotMessage(db, channelId, `✋ **Acknowledged:** ${updated.title}\n\`${updated.id.slice(0, 8)}\` • ${updated.severity} • ${new Date().toLocaleString()}`, threadId);
}

async function cmdResolve(db: Db, channelId: string, args: string[], threadId?: string | null) {
  if (args.length === 0) {
    await postBotMessage(db, channelId, '❌ Please specify incident ID: `@incident resolve <id-prefix> <resolution>`', threadId);
    return;
  }

  const idPrefix = args[0];
  const resolution = args.slice(1).join(' ') || 'Resolved';

  const found = await db.select().from(incidents)
    .where(and(
      ne(incidents.status, 'resolved'),
      sql`${incidents.id}::text LIKE ${idPrefix + '%'}`
    ))
    .limit(1);

  if (found.length === 0) {
    await postBotMessage(db, channelId, `❌ No open/acked incident found with ID starting with "${idPrefix}"`, threadId);
    return;
  }

  const uid = await ensureBotUser(db);
  const [updated] = await db.update(incidents)
    .set({ 
      status: 'resolved', 
      resolvedBy: uid, 
      resolvedAt: new Date(),
      resolution,
      updatedAt: new Date() 
    })
    .where(eq(incidents.id, found[0].id))
    .returning();

  await postBotMessage(db, channelId, `✅ **Resolved:** ${updated.title}\n\`${updated.id.slice(0, 8)}\` • ${updated.severity}\n**Resolution:** ${resolution}`, threadId);
}

async function cmdInfo(db: Db, channelId: string, query: string, threadId?: string | null) {
  if (!query) {
    await postBotMessage(db, channelId, '❌ Please specify an incident ID: `@incident info <id-prefix>`', threadId);
    return;
  }

  const found = await db.select().from(incidents)
    .where(sql`${incidents.id}::text LIKE ${query + '%'}`)
    .limit(1);

  if (found.length === 0) {
    await postBotMessage(db, channelId, `❌ No incident found with ID starting with "${query}"`, threadId);
    return;
  }

  const inc = found[0];
  const emoji = inc.severity === 'critical' ? '🔴' : inc.severity === 'warning' ? '🟡' : '🟢';
  const statusEmoji = inc.status === 'open' ? '🆕' : inc.status === 'acked' ? '✋' : '✅';

  const lines = [
    `${emoji}${statusEmoji} **${inc.title}**`,
    `**ID:** \`${inc.id.slice(0, 8)}\``,
    `**Severity:** ${inc.severity}`,
    `**Status:** ${inc.status}`,
    `**Opened:** ${inc.createdAt.toLocaleString()}`,
  ];

  if (inc.ackedAt) lines.push(`**Acknowledged:** ${inc.ackedAt.toLocaleString()}`);
  if (inc.resolvedAt) lines.push(`**Resolved:** ${inc.resolvedAt.toLocaleString()}`);
  if (inc.resolution) lines.push(`**Resolution:** ${inc.resolution}`);

  await postBotMessage(db, channelId, lines.join('\n'), threadId);
}

async function cmdHelp(db: Db, channelId: string, threadId?: string | null) {
  await postBotMessage(db, channelId, [
    '🚨 **IncidentBot Commands**',
    '',
    '`@incident open [critical|warning|info] <title>` — Create incident',
    '`@incident ack <id-prefix>` — Acknowledge incident',
    '`@incident resolve <id-prefix> <resolution>` — Resolve with notes',
    '`@incident list` — Show open/acked incidents',
    '`@incident info <id-prefix>` — Show incident details',
    '`@incident` — Show this help',
  ].join('\n'), threadId);
}
