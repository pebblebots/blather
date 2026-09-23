import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { agentCompletions, users, type Db } from "@blather/db";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";
import { isAgentUser } from "./activity.js";

export const completionRoutes = new Hono<Env>();
completionRoutes.use("*", authMiddleware);

const DEFAULT_COMPLETION_LIMIT = 50;
const MAX_COMPLETION_LIMIT = 200;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Refs are opaque object-store handles minted by the gateway — a bounded
// single-token shape, never free text. Anything that could smuggle prompt
// content into Postgres is rejected.
const REF_PATTERN = /^[A-Za-z0-9._/:@+-]{1,512}$/;
const MAX_MODEL_LENGTH = 255;
const MAX_SESSION_KEY_LENGTH = 255;
const MAX_METADATA_BYTES = 2048;

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

function optionalRef(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !REF_PATTERN.test(value)) {
    throw new Error(`${field} must be an opaque object-store ref (bounded, no whitespace)`);
  }
  return value;
}

function validatedMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadata must be an object");
  }
  const metadata = value as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > MAX_METADATA_BYTES) {
    throw new Error(`metadata must serialize to at most ${MAX_METADATA_BYTES} bytes`);
  }
  return metadata;
}

// Completions are ingested only by the trusted model gateway (the gravel LLM
// router), never self-reported by agents: within-user provenance — model,
// tokens, cost, refs — must come from server-side instrumentation the
// clankers cannot forge. The gateway's blather service accounts are named in
// COMPLETIONS_INGEST_EMAILS; when unset, ingestion is disabled.
async function isIngestUser(db: Db, userId: string): Promise<boolean> {
  const allowlist = (process.env.COMPLETIONS_INGEST_EMAILS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return false;
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(user && allowlist.includes(user.email.toLowerCase()));
}

async function canReadOtherAgents(db: Db, userId: string): Promise<boolean> {
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || (user.role !== "admin" && user.role !== "owner")) return false;
  return !(await isAgentUser(db, userId));
}

// POST /completions — record one model call's provenance (gateway only)
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

  if (!(await isIngestUser(db, userId))) {
    return c.json({ error: "Completions are ingested by the model gateway only" }, 403);
  }

  if (!body.agentUserId || typeof body.agentUserId !== "string") {
    return c.json({ error: "agentUserId is required" }, 400);
  }

  if (!body.model || typeof body.model !== "string" || !body.model.trim() || body.model.length > MAX_MODEL_LENGTH) {
    return c.json({ error: "model is required" }, 400);
  }

  const sessionKey = body.sessionKey ?? "";
  if (typeof sessionKey !== "string" || sessionKey.length > MAX_SESSION_KEY_LENGTH || /\s/.test(sessionKey)) {
    return c.json({ error: "sessionKey must be a short token without whitespace" }, 400);
  }

  let promptRef: string | null;
  let completionRef: string | null;
  let inputTokens: number | null;
  let outputTokens: number | null;
  let latencyMs: number | null;
  let metadata: Record<string, unknown>;
  try {
    promptRef = optionalRef(body.promptRef, "promptRef");
    completionRef = optionalRef(body.completionRef, "completionRef");
    inputTokens = optionalCount(body.inputTokens, "inputTokens");
    outputTokens = optionalCount(body.outputTokens, "outputTokens");
    latencyMs = optionalCount(body.latencyMs, "latencyMs");
    metadata = validatedMetadata(body.metadata);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  if (body.costUsd !== undefined && body.costUsd !== null && (typeof body.costUsd !== "number" || body.costUsd < 0)) {
    return c.json({ error: "costUsd must be a non-negative number" }, 400);
  }

  const [row] = await db
    .insert(agentCompletions)
    .values({
      agentUserId: body.agentUserId,
      sessionKey,
      model: body.model.trim(),
      promptRef,
      completionRef,
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd: body.costUsd !== undefined && body.costUsd !== null ? String(body.costUsd) : null,
      metadata,
    })
    .returning({ id: agentCompletions.id, createdAt: agentCompletions.createdAt });

  return c.json(row, 201);
});

// GET /completions — query recent completions for an agent.
// Agents may read only their own rows; cross-agent reads are for provenance
// review and require an admin/owner (non-agent) account or the gateway.
completionRoutes.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const agentId = c.req.query("agentId");
  const sessionKey = c.req.query("sessionKey");
  const since = c.req.query("since") || defaultSince();
  const limit = parseCompletionLimit(c.req.query("limit"));
  if (!agentId) return c.json({ error: "agentId required" }, 400);

  if (Number.isNaN(Date.parse(since))) {
    return c.json({ error: "since must be a valid timestamp" }, 400);
  }

  if (agentId !== userId && !(await canReadOtherAgents(db, userId)) && !(await isIngestUser(db, userId))) {
    return c.json({ error: "Reading another agent's completions requires an admin or owner account" }, 403);
  }

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
