import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { agentCompletions } from "@blather/db";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";

export const completionRoutes = new Hono<Env>();
completionRoutes.use("*", authMiddleware);

const DEFAULT_COMPLETION_LIMIT = 50;
const MAX_COMPLETION_LIMIT = 200;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

function parseCompletionLimit(rawLimit: string | undefined) {
  const parsedLimit = Number.parseInt(rawLimit ?? "", 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    return DEFAULT_COMPLETION_LIMIT;
  }

  return Math.min(parsedLimit, MAX_COMPLETION_LIMIT);
}

function optionalCount(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

// POST /completions — record one model call's provenance
completionRoutes.post("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const body = await c.req.json<{
    agentUserId?: string;
    sessionKey?: string;
    model: string;
    promptRef?: string;
    completionRef?: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    costUsd?: number;
    metadata?: Record<string, unknown>;
  }>();

  if (!body.model || typeof body.model !== "string" || !body.model.trim()) {
    return c.json({ error: "model is required" }, 400);
  }

  // Completions are always attributed to the authenticated caller. A client
  // that supplies agentUserId for another user is attempting to spoof
  // provenance — reject it rather than silently mislabel the row.
  if (body.agentUserId && body.agentUserId !== userId) {
    return c.json({ error: "Cannot log completions on behalf of another user" }, 403);
  }

  let inputTokens: number | null;
  let outputTokens: number | null;
  let latencyMs: number | null;
  try {
    inputTokens = optionalCount(body.inputTokens, "inputTokens");
    outputTokens = optionalCount(body.outputTokens, "outputTokens");
    latencyMs = optionalCount(body.latencyMs, "latencyMs");
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  if (body.costUsd !== undefined && body.costUsd !== null && (typeof body.costUsd !== "number" || body.costUsd < 0)) {
    return c.json({ error: "costUsd must be a non-negative number" }, 400);
  }

  const [row] = await db
    .insert(agentCompletions)
    .values({
      agentUserId: userId,
      sessionKey: body.sessionKey ?? "",
      model: body.model.trim(),
      promptRef: body.promptRef ?? null,
      completionRef: body.completionRef ?? null,
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd: body.costUsd !== undefined && body.costUsd !== null ? String(body.costUsd) : null,
      metadata: body.metadata ?? {},
    })
    .returning({ id: agentCompletions.id, createdAt: agentCompletions.createdAt });

  return c.json(row, 201);
});

// GET /completions — query recent completions for an agent
completionRoutes.get("/", async (c) => {
  const db = c.get("db");
  const agentId = c.req.query("agentId");
  const sessionKey = c.req.query("sessionKey");
  const since = c.req.query("since") || defaultSince();
  const limit = parseCompletionLimit(c.req.query("limit"));
  if (!agentId) return c.json({ error: "agentId required" }, 400);

  const sessionFilter = sessionKey !== undefined ? sql` AND session_key = ${sessionKey}` : sql``;
  const rows = await db.execute(sql`
    SELECT id, agent_user_id, session_key, model, prompt_ref, completion_ref,
           input_tokens, output_tokens, latency_ms, cost_usd, metadata, created_at
    FROM agent_completions
    WHERE agent_user_id = ${agentId} AND created_at >= ${since}::timestamptz${sessionFilter}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return c.json(resultRows(rows));
});
