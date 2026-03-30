import { Hono } from "hono";
import { sql, eq } from "drizzle-orm";
import { agentActivityLog, users, type Db } from "@blather/db";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";

export const activityRoutes = new Hono<Env>();
activityRoutes.use("*", authMiddleware);

const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 200;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type ActivityMetadata = Record<string, unknown>;

type ActivityEntry = {
  userId: string;
  action: string;
  targetChannelId?: string | null;
  targetMessageId?: string | null;
  metadata?: ActivityMetadata;
  sessionKey?: string;
};

type ActivitySummaryRow = {
  action: string;
  channel_name: string | null;
  cnt: number;
  metas: unknown[];
};

function plural(count: number, singular: string, pluralForm?: string): string {
  if (count === 1) return singular;
  return pluralForm ?? singular + 's';
}

function formatTaskIds(metas: ActivityMetadata[]): string {
  const ids = metas
    .map((m) => m.shortId)
    .filter((id): id is string | number => id !== undefined && id !== null)
    .map((id) => `T#${id}`)
    .join(', ');
  return ids ? ': ' + ids : '';
}

type ActionFormatter = (count: number, channelName: string | null, metas: ActivityMetadata[]) => string;

function inChannel(channelName: string | null): string {
  return channelName ? ` in #${channelName}` : '';
}

const ACTION_LABELS: Record<string, ActionFormatter> = {
  message_sent: (count, ch) =>
    `Sent ${count} ${plural(count, 'message')}${inChannel(ch)}`,
  task_created: (count, _ch, metas) =>
    `Created ${count} ${plural(count, 'task')}${formatTaskIds(metas)}`,
  task_completed: (count, _ch, metas) =>
    `Completed ${count} ${plural(count, 'task')}${formatTaskIds(metas)}`,
  task_updated: (count) =>
    `Updated ${count} ${plural(count, 'task')}`,
  reaction_added: (count, ch, metas) => {
    const emojis = [...new Set(metas.map((m) => m.emoji).filter((e): e is string => typeof e === 'string' && e.length > 0))].join(' ');
    const prefix = emojis ? `${emojis} ` : '';
    return `Reacted ${prefix}to ${count} ${plural(count, 'message')}${inChannel(ch)}`;
  },
  file_uploaded: (count, ch) =>
    `Uploaded ${count} ${plural(count, 'file')}${inChannel(ch)}`,
  search_performed: (count) =>
    `Performed ${count} ${plural(count, 'search', 'searches')}`,
};

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function defaultSince() {
  return new Date(Date.now() - ONE_DAY_MS).toISOString();
}

function parseActivityLimit(rawLimit: string | undefined) {
  const parsedLimit = Number.parseInt(rawLimit ?? "", 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    return DEFAULT_ACTIVITY_LIMIT;
  }

  return Math.min(parsedLimit, MAX_ACTIVITY_LIMIT);
}

function activityInsertValues(entry: ActivityEntry) {
  return {
    agentUserId: entry.userId,
    sessionKey: entry.sessionKey ?? "",
    action: entry.action,
    targetChannelId: entry.targetChannelId ?? null,
    targetMessageId: entry.targetMessageId ?? null,
    metadata: entry.metadata ?? {},
  };
}

function isMetadataRecord(value: unknown): value is ActivityMetadata {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function metadataList(value: unknown): ActivityMetadata[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isMetadataRecord);
}

// POST /activity — log an activity entry
activityRoutes.post("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const body = await c.req.json<{
    agentUserId: string;
    sessionKey?: string;
    action: string;
    targetChannelId?: string;
    targetMessageId?: string;
    metadata?: ActivityMetadata;
  }>();
  const { agentUserId, sessionKey, action, targetChannelId, targetMessageId, metadata } = body;
  if (!agentUserId || !action) {
    return c.json({ error: "agentUserId and action are required" }, 400);
  }

  const [row] = await db
    .insert(agentActivityLog)
    .values(
      activityInsertValues({
        userId: agentUserId,
        sessionKey,
        action,
        targetChannelId,
        targetMessageId,
        metadata,
      }),
    )
    .returning({ id: agentActivityLog.id, createdAt: agentActivityLog.createdAt });

  return c.json(row, 201);
});

// GET /activity — query recent activity
activityRoutes.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const agentId = c.req.query("agentId");
  const since = c.req.query("since") || defaultSince();
  const limit = parseActivityLimit(c.req.query("limit"));
  if (!agentId) return c.json({ error: "agentId required" }, 400);

  const rows = await db.execute(sql`
    SELECT id, agent_user_id, session_key, action, target_channel_id, target_message_id, metadata, created_at
    FROM agent_activity_log
    WHERE agent_user_id = ${agentId} AND created_at >= ${since}::timestamptz
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return c.json(resultRows(rows));
});

// GET /activity/summary — condensed text summary
activityRoutes.get("/summary", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const agentId = c.req.query("agentId");
  const since = c.req.query("since") || defaultSince();
  if (!agentId) return c.json({ error: "agentId required" }, 400);

  const rows = await db.execute(sql`
    SELECT a.action, c.name as channel_name, a.target_channel_id, count(*)::int as cnt,
           jsonb_agg(a.metadata ORDER BY a.created_at DESC) as metas
    FROM agent_activity_log a
    LEFT JOIN channels c ON c.id = a.target_channel_id
    WHERE a.agent_user_id = ${agentId} AND a.created_at >= ${since}::timestamptz
    GROUP BY a.action, c.name, a.target_channel_id
    ORDER BY cnt DESC
  `);
  const summaryRows = resultRows<ActivitySummaryRow>(rows);

  const lines = [`## Activity since ${since}`];
  for (const row of summaryRows) {
    const formatAction = ACTION_LABELS[row.action];
    const metas = metadataList(row.metas);
    if (formatAction) {
      lines.push('- ' + formatAction(row.cnt, row.channel_name, metas));
    } else {
      lines.push(`- ${row.action}: ${row.cnt} ${plural(row.cnt, 'time')}${inChannel(row.channel_name)}`);
    }
  }

  if (summaryRows.length === 0) lines.push('- No activity recorded');

  return c.json({ summary: lines.join('\n'), rows: summaryRows });
});

// Helper: log activity (exported for use by other routes)
export async function logAgentActivity(db: Db, entry: ActivityEntry) {
  try {
    await db.insert(agentActivityLog).values(activityInsertValues(entry));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[activity-log] Failed to log:', message);
  }
}

// Helper: check if user is an agent
export async function isAgentUser(db: Db, userId: string): Promise<boolean> {
  try {
    const [user] = await db.select({ isAgent: users.isAgent, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return false;
    const agentDomains = (process.env.AGENT_EMAIL_DOMAIN || 'system.blather').split(',').map(d => d.trim());
    return user.isAgent || !!(user.email && agentDomains.some(d => user.email.endsWith(`@${d}`)));
  } catch {
    return false;
  }
}
