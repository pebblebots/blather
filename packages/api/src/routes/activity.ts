import { Hono } from "hono";
import { sql, eq } from "drizzle-orm";
import { users, channels } from "@blather/db";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";

export const activityRoutes = new Hono<Env>();
activityRoutes.use("*", authMiddleware);

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

// POST /activity — log an activity entry
activityRoutes.post("/", async (c) => {
  const db = c.get("db");
  const body = await c.req.json<{
    workspaceId: string;
    agentUserId: string;
    sessionKey?: string;
    action: string;
    targetChannelId?: string;
    targetMessageId?: string;
    metadata?: Record<string, unknown>;
  }>();
  const { workspaceId, agentUserId, sessionKey, action, targetChannelId, targetMessageId, metadata } = body;
  if (!workspaceId || !agentUserId || !action) {
    return c.json({ error: "workspaceId, agentUserId, and action are required" }, 400);
  }
  const result = await db.execute(sql`
    INSERT INTO agent_activity_log (workspace_id, agent_user_id, session_key, action, target_channel_id, target_message_id, metadata)
    VALUES (${workspaceId}, ${agentUserId}, ${sessionKey || ''}, ${action}, ${targetChannelId || null}, ${targetMessageId || null}, ${JSON.stringify(metadata || {})}::jsonb)
    RETURNING id, created_at
  `);
  const [row] = resultRows<{ id: string; created_at: string | Date }>(result);
  return c.json({ id: row?.id, createdAt: row?.created_at }, 201);
});

// GET /activity — query recent activity
activityRoutes.get("/", async (c) => {
  const db = c.get("db");
  const agentId = c.req.query("agentId");
  const since = c.req.query("since") || new Date(Date.now() - 86400000).toISOString();
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  if (!agentId) return c.json({ error: "agentId required" }, 400);

  const rows = await db.execute(sql`
    SELECT id, workspace_id, agent_user_id, session_key, action, target_channel_id, target_message_id, metadata, created_at
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
  const agentId = c.req.query("agentId");
  const since = c.req.query("since") || new Date(Date.now() - 86400000).toISOString();
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
  const summaryRows = resultRows<{
    action: string;
    channel_name: string | null;
    cnt: number;
    metas: unknown[];
  }>(rows);

  type ActionFormatter = (cnt: number, ch: string | null, metas: any[]) => string;
  const actionLabels: Record<string, ActionFormatter> = {
    message_sent: (cnt, ch) => `Sent ${cnt} message${cnt > 1 ? 's' : ''}${ch ? ' in #' + ch : ''}`,
    task_created: (cnt, _ch, metas) => {
      const ids = metas.filter(m => m.shortId).map(m => 'T#' + m.shortId).join(', ');
      return `Created ${cnt} task${cnt > 1 ? 's' : ''}${ids ? ': ' + ids : ''}`;
    },
    task_completed: (cnt, _ch, metas) => {
      const ids = metas.filter(m => m.shortId).map(m => 'T#' + m.shortId).join(', ');
      return `Completed ${cnt} task${cnt > 1 ? 's' : ''}${ids ? ': ' + ids : ''}`;
    },
    task_updated: (cnt) => `Updated ${cnt} task${cnt > 1 ? 's' : ''}`,
    reaction_added: (cnt, ch, metas) => {
      const emojis = [...new Set(metas.map(m => m.emoji).filter(Boolean))].join(' ');
      return `Reacted ${emojis || ''} to ${cnt} message${cnt > 1 ? 's' : ''}${ch ? ' in #' + ch : ''}`;
    },
    file_uploaded: (cnt, ch) => `Uploaded ${cnt} file${cnt > 1 ? 's' : ''}${ch ? ' in #' + ch : ''}`,
    search_performed: (cnt) => `Performed ${cnt} search${cnt > 1 ? 'es' : ''}`,
  };

  const lines = [`## Activity since ${since}`];
  for (const row of summaryRows) {
    const fn = actionLabels[row.action];
    const ch = row.channel_name;
    const metas = Array.isArray(row.metas) ? row.metas : [];
    if (fn) {
      lines.push('- ' + fn(row.cnt, ch, metas));
    } else {
      lines.push(`- ${row.action}: ${row.cnt} time${row.cnt > 1 ? 's' : ''}${ch ? ' in #' + ch : ''}`);
    }
  }

  if (summaryRows.length === 0) lines.push('- No activity recorded');

  return c.json({ summary: lines.join('\n'), rows: summaryRows });
});

// Helper: log activity (exported for use by other routes)
export async function logAgentActivity(db: any, entry: {
  workspaceId: string;
  userId: string;
  action: string;
  targetChannelId?: string | null;
  targetMessageId?: string | null;
  metadata?: Record<string, unknown>;
  sessionKey?: string;
}) {
  try {
    await db.execute(sql`
      INSERT INTO agent_activity_log (workspace_id, agent_user_id, session_key, action, target_channel_id, target_message_id, metadata)
      VALUES (${entry.workspaceId}, ${entry.userId}, ${entry.sessionKey || ''}, ${entry.action}, ${entry.targetChannelId || null}, ${entry.targetMessageId || null}, ${JSON.stringify(entry.metadata || {})}::jsonb)
    `);
  } catch (e: any) {
    console.error('[activity-log] Failed to log:', e.message);
  }
}

// Helper: check if user is an agent
export async function isAgentUser(db: any, userId: string): Promise<boolean> {
  try {
    const [user] = await db.select({ isAgent: users.isAgent, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return false;
    const agentDomains = (process.env.AGENT_EMAIL_DOMAIN || 'system.blather').split(',').map(d => d.trim());
    return user.isAgent || (user.email && agentDomains.some(d => user.email.endsWith(`@${d}`)));
  } catch {
    return false;
  }
}
