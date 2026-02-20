import { eq, and } from "drizzle-orm";
import { huddles, huddleParticipants, messages, users, channels, channelMembers } from "@blather/db";
import { createDb } from "@blather/db";
import { publishEvent } from "../ws/manager.js";
import { emitEvent } from "../ws/events.js";
import { generateTTS } from "./tts.js";

const db = createDb();

interface AgentState {
  userId: string;
  displayName: string;
  lastSpoke: number; // timestamp
}

interface ActiveOrchestrator {
  huddleId: string;
  channelId: string;
  workspaceId: string;
  topic: string;
  nudgeTimer: ReturnType<typeof setTimeout> | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  agents: AgentState[];
  lastSpeakerId: string | null;
}

const activeOrchestrators = new Map<string, ActiveOrchestrator>();

// Message listener - checks new messages against active huddle channels
const huddleChannelMap = new Map<string, string>(); // channelId -> huddleId

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function onMessageCreated(channelId: string, messageData: {
  id: string;
  userId: string;
  content: string;
  isAgent: boolean;
  voice?: string | null;
  displayName?: string;
}) {
  const huddleId = huddleChannelMap.get(channelId);
  if (!huddleId) return;
  const orch = activeOrchestrators.get(huddleId);
  if (!orch || orch.stopped) return;
  console.log(`[Huddle] onMessageCreated: channel=${channelId} user=${messageData.displayName} huddleId=${huddleId}`);

  // Update agent lastSpoke
  const agent = orch.agents.find(a => a.userId === messageData.userId);
  if (agent) {
    agent.lastSpoke = Date.now();
    orch.lastSpeakerId = messageData.userId;
  }

  // Reset nudge timer
  resetNudgeTimer(orch);

  // Schedule turn-taking: after an agent speaks, nudge the next quiet agent
  if (messageData.isAgent || agent) {
    scheduleTurnTaking(orch);
  }

  // TTS the message and broadcast
  if (messageData.isAgent || messageData.userId) {
    handleHuddleMessage(orch, messageData).catch(err => {
      console.error(`[Huddle] TTS error for message ${messageData.id}:`, err);
    });
  }
}

function getNextQuietAgent(orch: ActiveOrchestrator): AgentState | null {
  if (orch.agents.length === 0) return null;
  // Sort by lastSpoke ascending — pick the one who hasn't spoken recently
  const sorted = [...orch.agents].sort((a, b) => a.lastSpoke - b.lastSpoke);
  // Skip the one who just spoke
  const candidate = sorted.find(a => a.userId !== orch.lastSpeakerId) || sorted[0];
  return candidate;
}

function scheduleTurnTaking(orch: ActiveOrchestrator) {
  if (orch.turnTimer) clearTimeout(orch.turnTimer);
  if (orch.stopped) return;

  // Wait 3-5 seconds then nudge the next agent
  const delay = 3000 + Math.random() * 2000;
  orch.turnTimer = setTimeout(async () => {
    if (orch.stopped) return;
    const next = getNextQuietAgent(orch);
    if (!next) return;

    // Only nudge if they haven't spoken in the last 5 seconds
    if (Date.now() - next.lastSpoke < 5000) return;

    await postTargetedNudge(orch, next);
  }, delay);
}

async function postTargetedNudge(orch: ActiveOrchestrator, agent: AgentState) {
  if (orch.stopped) return;
  try {
    const nudgeContent = `@${agent.displayName} — what are your thoughts on ${orch.topic}?`;

    const [msg] = await db.insert(messages).values({
      channelId: orch.channelId,
      userId: agent.userId, // Post "from" the system but directed at agent
      content: nudgeContent,
    }).returning();

    const [channel] = await db.select().from(channels).where(eq(channels.id, orch.channelId)).limit(1);
    if (channel) {
      await emitEvent(db, {
        workspaceId: orch.workspaceId,
        channelId: orch.channelId,
        userId: agent.userId,
        type: "message.created",
        payload: {
          id: msg.id,
          channelId: msg.channelId,
          userId: msg.userId,
          content: nudgeContent,
          threadId: null,
          createdAt: msg.createdAt.toISOString(),
          attachments: [],
        },
      });
    }
  } catch (err) {
    console.error("[Huddle] Targeted nudge error:", err);
  }
}

async function handleHuddleMessage(orch: ActiveOrchestrator, msg: {
  id: string;
  userId: string;
  content: string;
  voice?: string | null;
  displayName?: string;
}) {
  const voice = msg.voice || "echo";

  // Broadcast speaking event
  await publishEvent(orch.workspaceId, {
    type: "huddle.speaking",
    data: { huddleId: orch.huddleId, userId: msg.userId, displayName: msg.displayName },
  });

  try {
    const { audioUrl, duration } = await generateTTS(msg.content, voice, msg.id);
    console.log(`[Huddle] TTS generated: audioUrl=${audioUrl} duration=${duration} msgId=${msg.id}`);

    await publishEvent(orch.workspaceId, {
      type: "huddle.audio",
      data: {
        huddleId: orch.huddleId,
        messageId: msg.id,
        userId: msg.userId,
        audioUrl,
        content: msg.content,
        duration,
      },
    });
  } catch (err) {
    console.error(`[Huddle] TTS failed for ${msg.id}:`, err);
  }
}

function resetNudgeTimer(orch: ActiveOrchestrator) {
  if (orch.nudgeTimer) clearTimeout(orch.nudgeTimer);
  if (orch.stopped) return;

  orch.nudgeTimer = setTimeout(async () => {
    if (orch.stopped) return;
    // Pick the quietest agent and nudge them specifically
    const next = getNextQuietAgent(orch);
    if (!next) return;
    await postTargetedNudge(orch, next);
  }, 15000);
}

export async function startOrchestrator(params: {
  huddleId: string;
  channelId: string;
  workspaceId: string;
  topic: string;
  agentNames: string[];
  maxDurationMs: number;
  createdBy: string;
}) {
  // Load agent participants with their details
  const agentParticipants = await db.select({
    userId: huddleParticipants.userId,
    displayName: users.displayName,
  }).from(huddleParticipants)
    .innerJoin(users, eq(huddleParticipants.userId, users.id))
    .where(and(eq(huddleParticipants.huddleId, params.huddleId), eq(huddleParticipants.role, "agent")));

  const orch: ActiveOrchestrator = {
    huddleId: params.huddleId,
    channelId: params.channelId,
    workspaceId: params.workspaceId,
    topic: params.topic,
    nudgeTimer: null,
    turnTimer: null,
    maxTimer: null,
    stopped: false,
    agents: agentParticipants.map(a => ({
      userId: a.userId,
      displayName: a.displayName,
      lastSpoke: 0,
    })),
    lastSpeakerId: null,
  };

  activeOrchestrators.set(params.huddleId, orch);
  huddleChannelMap.set(params.channelId, params.huddleId);

  // Post initial message
  const initContent = `🎙️ Huddle started! Topic: ${params.topic}. Participants: ${params.agentNames.join(", ")}. Keep responses conversational — 1-3 sentences max.`;

  const [msg] = await db.insert(messages).values({
    channelId: params.channelId,
    userId: params.createdBy,
    content: initContent,
  }).returning();

  await emitEvent(db, {
    workspaceId: params.workspaceId,
    channelId: params.channelId,
    userId: params.createdBy,
    type: "message.created",
    payload: {
      id: msg.id,
      channelId: msg.channelId,
      userId: msg.userId,
      content: msg.content,
      threadId: null,
      createdAt: msg.createdAt.toISOString(),
      attachments: [],
    },
  });

  // Post personalized prompts to each agent, staggered by 1-2 seconds
  for (const agent of orch.agents) {
    await sleep(1000 + Math.random() * 1000);
    if (orch.stopped) break;

    const promptContent = `@${agent.displayName} — You're in a huddle about "${params.topic}". Share your perspective in 1-3 sentences. Be conversational. You can ask questions or build on what others say.`;

    const [promptMsg] = await db.insert(messages).values({
      channelId: params.channelId,
      userId: params.createdBy,
      content: promptContent,
    }).returning();

    await emitEvent(db, {
      workspaceId: params.workspaceId,
      channelId: params.channelId,
      userId: params.createdBy,
      type: "message.created",
      payload: {
        id: promptMsg.id,
        channelId: promptMsg.channelId,
        userId: promptMsg.userId,
        content: promptContent,
        threadId: null,
        createdAt: promptMsg.createdAt.toISOString(),
        attachments: [],
      },
    });

    console.log(`[Huddle] Sent personalized prompt to ${agent.displayName}`);
  }

  // Start nudge timer
  resetNudgeTimer(orch);

  // Max duration timeout
  orch.maxTimer = setTimeout(async () => {
    if (orch.stopped) return;
    await endHuddle(params.huddleId, params.createdBy);
  }, params.maxDurationMs);

  // Broadcast huddle.created
  await publishEvent(params.workspaceId, {
    type: "huddle.created",
    data: {
      huddleId: params.huddleId,
      topic: params.topic,
      channelId: params.channelId,
    },
  });
}

export async function endHuddle(huddleId: string, endedBy: string) {
  const orch = activeOrchestrators.get(huddleId);
  if (orch) {
    orch.stopped = true;
    if (orch.nudgeTimer) clearTimeout(orch.nudgeTimer);
    if (orch.turnTimer) clearTimeout(orch.turnTimer);
    if (orch.maxTimer) clearTimeout(orch.maxTimer);
    huddleChannelMap.delete(orch.channelId);
    activeOrchestrators.delete(huddleId);

    // Post closing message
    const closingContent = `🎙️ Huddle ended. Thanks for the conversation!`;
    const [msg] = await db.insert(messages).values({
      channelId: orch.channelId,
      userId: endedBy,
      content: closingContent,
    }).returning();

    await emitEvent(db, {
      workspaceId: orch.workspaceId,
      channelId: orch.channelId,
      userId: endedBy,
      type: "message.created",
      payload: {
        id: msg.id,
        channelId: msg.channelId,
        userId: msg.userId,
        content: msg.content,
        threadId: null,
        createdAt: msg.createdAt.toISOString(),
        attachments: [],
      },
    });
  }

  // Update DB
  await db.update(huddles).set({
    status: "ended",
    endedAt: new Date(),
  }).where(eq(huddles.id, huddleId));

  // Get workspace ID for broadcast
  const [huddle] = await db.select().from(huddles).where(eq(huddles.id, huddleId)).limit(1);
  if (huddle) {
    await publishEvent(huddle.workspaceId, {
      type: "huddle.ended",
      data: { huddleId },
    });
  }
}

export function getOrchestrator(huddleId: string) {
  return activeOrchestrators.get(huddleId);
}

export function isHuddleChannel(channelId: string): boolean {
  return huddleChannelMap.has(channelId);
}
