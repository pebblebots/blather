import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { huddles, huddleParticipants, users, channels, channelMembers } from "@blather/db";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";
import { startOrchestrator, endHuddle } from "../huddle/orchestrator.js";
import { generateTTS } from "../huddle/tts.js";
import { publishEvent } from "../ws/manager.js";
import { emitEvent } from "../ws/events.js";
import { messages } from "@blather/db";
import { randomBytes } from "crypto";

export const huddleRoutes = new Hono<Env>();
huddleRoutes.use("*", authMiddleware);

// POST /huddles — Create a huddle
huddleRoutes.post("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const body = await c.req.json<{ topic: string; agentIds: string[]; starter?: string }>();

  const { topic, agentIds, starter } = body;
  if (!topic || !agentIds?.length) {
    return c.json({ error: "topic and agentIds are required" }, 400);
  }
  if (agentIds.length > 3) {
    return c.json({ error: "Maximum 3 agents per huddle" }, 400);
  }

  // Verify creator is not an agent
  const [creator] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!creator) return c.json({ error: "User not found" }, 404);
  if (creator.isAgent) return c.json({ error: "Agents cannot create huddles" }, 403);

  // Verify all agents exist and are actually agents
  const agentUsers: { id: string; displayName: string; voice: string | null }[] = [];
  for (const agentId of agentIds) {
    const [agent] = await db.select().from(users).where(eq(users.id, agentId)).limit(1);
    if (!agent) return c.json({ error: `Agent ${agentId} not found` }, 404);
    if (!agent.isAgent) return c.json({ error: `User ${agentId} is not an agent` }, 400);
    agentUsers.push({ id: agent.id, displayName: agent.displayName, voice: agent.voice });
  }

  // Create a private channel for the huddle
  const shortId = randomBytes(4).toString("hex");
  const channelName = `huddle-${shortId}`;

  const [channel] = await db.insert(channels).values({
    name: channelName,
    slug: channelName,
    channelType: "private",
    createdBy: userId,
  }).returning();

  // Add creator + all agents as channel members
  const memberValues = [
    { channelId: channel.id, userId },
    ...agentIds.map(id => ({ channelId: channel.id, userId: id })),
  ];
  await db.insert(channelMembers).values(memberValues);

  // Create huddle record
  const [huddle] = await db.insert(huddles).values({
    topic,
    channelId: channel.id,
    createdBy: userId,
  }).returning();

  // Create participant records
  const participantValues = [
    { huddleId: huddle.id, userId, role: "listener" },
    ...agentIds.map(id => ({ huddleId: huddle.id, userId: id, role: "agent" })),
  ];
  await db.insert(huddleParticipants).values(participantValues);

  // Start orchestrator
  await startOrchestrator({
    huddleId: huddle.id,
    channelId: channel.id,
    topic,
    agentNames: agentUsers.map(a => a.displayName),
    maxDurationMs: huddle.maxDurationMs,
    starter: starter || null,
    createdBy: userId,
  });

  // Return huddle with participants
  const participants = await db.select({
    userId: huddleParticipants.userId,
    role: huddleParticipants.role,
    joinedAt: huddleParticipants.joinedAt,
    displayName: users.displayName,
    isAgent: users.isAgent,
  }).from(huddleParticipants)
    .innerJoin(users, eq(huddleParticipants.userId, users.id))
    .where(eq(huddleParticipants.huddleId, huddle.id));

  return c.json({ ...huddle, channel, participants }, 201);
});

// GET /huddles?status=active
huddleRoutes.get("/", async (c) => {
  const db = c.get("db");

  const status = c.req.query("status") || "active";
  const conditions: any[] = [];
  if (status !== "all") {
    conditions.push(eq(huddles.status, status as "active" | "ended"));
  }

  const result = await db.select().from(huddles).where(conditions.length > 0 ? and(...conditions) : undefined);
  return c.json(result);
});

// GET /huddles/:id
huddleRoutes.get("/:id", async (c) => {
  const db = c.get("db");
  const huddleId = c.req.param("id");

  const [huddle] = await db.select().from(huddles).where(eq(huddles.id, huddleId)).limit(1);
  if (!huddle) return c.json({ error: "Huddle not found" }, 404);

  const participants = await db.select({
    userId: huddleParticipants.userId,
    role: huddleParticipants.role,
    joinedAt: huddleParticipants.joinedAt,
    displayName: users.displayName,
    isAgent: users.isAgent,
  }).from(huddleParticipants)
    .innerJoin(users, eq(huddleParticipants.userId, users.id))
    .where(eq(huddleParticipants.huddleId, huddleId));

  const [channel] = await db.select().from(channels).where(eq(channels.id, huddle.channelId)).limit(1);

  return c.json({ ...huddle, channel, participants });
});

// POST /huddles/:id/join
huddleRoutes.post("/:id/join", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const huddleId = c.req.param("id");

  const [huddle] = await db.select().from(huddles).where(eq(huddles.id, huddleId)).limit(1);
  if (!huddle) return c.json({ error: "Huddle not found" }, 404);
  if (huddle.status !== "active") return c.json({ error: "Huddle is not active" }, 400);

  // Check already a participant
  const [existing] = await db.select().from(huddleParticipants)
    .where(and(eq(huddleParticipants.huddleId, huddleId), eq(huddleParticipants.userId, userId)))
    .limit(1);
  if (existing) return c.json({ error: "Already a participant" }, 409);

  // Add as listener
  await db.insert(huddleParticipants).values({ huddleId, userId, role: "listener" });
  // Ignore duplicate-key error if already a channel member
  await db.insert(channelMembers).values({ channelId: huddle.channelId, userId }).catch(() => {});

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  await publishEvent({
    type: "huddle.joined",
    data: { huddleId, userId, displayName: user?.displayName },
  });

  return c.json({ ok: true });
});

// POST /huddles/:id/speak
huddleRoutes.post("/:id/speak", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const huddleId = c.req.param("id");
  const body = await c.req.json<{ content: string }>();

  const [huddle] = await db.select().from(huddles).where(eq(huddles.id, huddleId)).limit(1);
  if (!huddle) return c.json({ error: "Huddle not found" }, 404);
  if (huddle.status !== "active") return c.json({ error: "Huddle is not active" }, 400);

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const voice = user?.voice || "echo";

  // Post message to channel
  const [msg] = await db.insert(messages).values({
    channelId: huddle.channelId,
    userId,
    content: body.content,
  }).returning();

  // Emit message event
  await emitEvent(db, {
    channelId: huddle.channelId,
    userId,
    type: "message.created",
    payload: {
      id: msg.id,
      channelId: msg.channelId,
      userId: msg.userId,
      content: msg.content,
      threadId: null,
      createdAt: msg.createdAt.toISOString(),
      attachments: [],
      user: user ? { displayName: user.displayName, isAgent: user.isAgent } : undefined,
    },
  });

  // TTS and broadcast
  try {
    const { audioUrl, duration } = await generateTTS(body.content, voice, msg.id);
    await publishEvent({
      type: "huddle.audio",
      data: {
        huddleId,
        messageId: msg.id,
        userId,
        audioUrl,
        content: body.content,
        duration,
      },
    });
  } catch (err) {
    console.error("[Huddle] TTS error on speak:", err);
  }

  return c.json({ ok: true, messageId: msg.id });
});

// DELETE /huddles/:id — End huddle
huddleRoutes.delete("/:id", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const huddleId = c.req.param("id");

  const [huddle] = await db.select().from(huddles).where(eq(huddles.id, huddleId)).limit(1);
  if (!huddle) return c.json({ error: "Huddle not found" }, 404);
  if (huddle.status !== "active") return c.json({ error: "Huddle already ended" }, 400);
  if (huddle.createdBy !== userId) return c.json({ error: "Only the creator can end the huddle" }, 403);

  await endHuddle(huddleId, userId);
  return c.json({ ok: true });
});
