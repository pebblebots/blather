import { eq, and, desc } from "drizzle-orm";
import { huddles, huddleParticipants, messages, users, channels, channelMembers } from "@blather/db";
import { createDb } from "@blather/db";
import { publishEvent } from "../ws/manager.js";
import { emitEvent } from "../ws/events.js";
import { generateTTS } from "./tts.js";

const db = createDb();

type Phase = "opening" | "debate" | "synthesis";

interface AgentState {
  userId: string;
  displayName: string;
  bio: string | null;
  lastSpoke: number;
  messageCount: number;
  pendingNudge: boolean;
}

interface ActiveOrchestrator {
  huddleId: string;
  channelId: string;
  topic: string;
  starter: string | null;
  nudgeTimer: ReturnType<typeof setTimeout> | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  agents: AgentState[];
  lastSpeakerId: string | null;
  totalMessages: number;
  startedAt: number;
  phase: Phase;
  createdBy: string;
}

const activeOrchestrators = new Map<string, ActiveOrchestrator>();
const huddleChannelMap = new Map<string, string>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCurrentPhase(orch: ActiveOrchestrator): Phase {
  const elapsed = Date.now() - orch.startedAt;
  if (orch.totalMessages <= 6 && elapsed < 2 * 60 * 1000) return "opening";
  if (orch.totalMessages <= 18 && elapsed < 8 * 60 * 1000) return "debate";
  return "synthesis";
}

function assignAngles(topic: string, agents: AgentState[]): Map<string, string> {
  const angles = new Map<string, string>();
  
  const twoAngles = [
    ["the optimistic case — argue this will create massive value", "the skeptical case — argue this is overhyped and the risks are underappreciated"],
    ["the builder's perspective — what's technically feasible right now", "the investor's perspective — where the money will actually flow"],
    ["the adoption argument — why this goes mainstream fast", "the structural barriers — why this stalls or fragments"],
  ];

  const threeAngles = [
    ["the technology angle — what's actually possible and what breaks", "the business/money angle — who captures value and who gets commoditized", "the culture/adoption angle — how real people will actually use this"],
    ["the optimist — make the bull case", "the skeptic — make the bear case", "the pragmatist — find the nuanced middle ground others are missing"],
    ["the systems thinker — second-order effects everyone's ignoring", "the historian — what past analogies tell us about how this plays out", "the contrarian — the take nobody wants to hear but might be right"],
  ];

  // Pick angle set based on topic hash for variety
  const hash = topic.split('').reduce((a, c) => a + c.charCodeAt(0), 0);

  if (agents.length === 2) {
    const set = twoAngles[hash % twoAngles.length];
    agents.forEach((a, i) => angles.set(a.userId, set[i]));
  } else if (agents.length >= 3) {
    const set = threeAngles[hash % threeAngles.length];
    agents.forEach((a, i) => angles.set(a.userId, set[i % set.length]));
  } else if (agents.length === 1) {
    angles.set(agents[0].userId, "give your honest, opinionated take — don't hold back");
  }

  // Refine based on bios if available
  // If an agent has a finance bio, prefer giving them the money angle, etc.
  if (agents.length >= 2) {
    const financeBio = agents.find(a => a.bio && /financ|valuat|portfolio|invest|money/i.test(a.bio));
    const techBio = agents.find(a => a.bio && /build|engineer|architect|system/i.test(a.bio));
    const cultureBio = agents.find(a => a.bio && /culture|trend|adopt|social|research/i.test(a.bio));
    
    if (agents.length === 2) {
      if (financeBio && techBio && financeBio !== techBio) {
        angles.set(financeBio.userId, "the investment thesis — where value accrues and what gets commoditized");
        angles.set(techBio.userId, "the builder's reality check — what's actually shippable vs vaporware");
      } else if (financeBio && cultureBio && financeBio !== cultureBio) {
        angles.set(financeBio.userId, "the money view — follow the capital and incentive structures");
        angles.set(cultureBio.userId, "the adoption view — how real humans and communities will shape this");
      }
    }
    
    if (agents.length >= 3 && financeBio && techBio && cultureBio && 
        financeBio !== techBio && techBio !== cultureBio && financeBio !== cultureBio) {
      angles.set(financeBio.userId, "the money angle — who captures value, who gets commoditized, and where to place bets");
      angles.set(techBio.userId, "the builder's angle — what's technically real, what breaks at scale, what's vaporware");
      angles.set(cultureBio.userId, "the adoption angle — how people actually behave, what patterns from history repeat");
    }
  }

  return angles;
}

function buildAgentPrompt(agent: AgentState, topic: string, angle: string, starter: string | null, allAgents: AgentState[]): string {
  const otherNames = allAgents.filter(a => a.userId !== agent.userId).map(a => a.displayName);
  const bioLine = agent.bio ? `Your expertise: ${agent.bio}` : "";
  const starterLine = starter ? `\nA provocative seed to react to: "${starter}"` : "";
  const othersLine = otherNames.length > 0 ? ` You're debating with ${otherNames.join(" and ")}.` : "";
  
  return `@${agent.displayName} — Huddle topic: "${topic}". ${bioLine}\n\nYour angle: ${angle}.${starterLine}${othersLine}\n\nIMPORTANT: Keep responses to 1-2 sentences MAX. This is a quick conversation, not an essay. Be punchy and opinionated. Riff on what others say.`;
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

  // Update agent lastSpoke + message counts
  const agent = orch.agents.find(a => a.userId === messageData.userId);
  if (agent) {
    agent.lastSpoke = Date.now();
    agent.messageCount++;
    agent.pendingNudge = false;
    orch.lastSpeakerId = messageData.userId;
  }
  orch.totalMessages++;
  
  // Update phase
  orch.phase = getCurrentPhase(orch);

  resetNudgeTimer(orch);

  if (messageData.isAgent || agent) {
    scheduleTurnTaking(orch);
  }

  // Generate TTS audio for every huddle message
  handleHuddleMessage(orch, messageData).catch(err => {
    console.error(`[Huddle] TTS error for message ${messageData.id}:`, err);
  });
}

function getNextQuietAgent(orch: ActiveOrchestrator): AgentState | null {
  if (orch.agents.length === 0) return null;
  const sorted = [...orch.agents].sort((a, b) => a.lastSpoke - b.lastSpoke);
  const candidate = sorted.find(a => a.userId !== orch.lastSpeakerId) || sorted[0];
  return candidate;
}

function scheduleTurnTaking(orch: ActiveOrchestrator) {
  if (orch.turnTimer) clearTimeout(orch.turnTimer);
  if (orch.stopped) return;

  const delay = 15000 + Math.random() * 5000;
  orch.turnTimer = setTimeout(async () => {
    if (orch.stopped) return;
    const next = getNextQuietAgent(orch);
    if (!next) return;
    if (Date.now() - next.lastSpoke < 20000) return;
    if (next.pendingNudge) return;
    await postTargetedNudge(orch, next);
  }, delay);
}

async function postTargetedNudge(orch: ActiveOrchestrator, agent: AgentState) {
  if (orch.stopped) return;
  if (agent.pendingNudge) return;
  try {
    const phase = getCurrentPhase(orch);
    let nudgeContent: string;

    const lastSpeaker = orch.agents.find(a => a.userId === orch.lastSpeakerId);
    const lastSpeakerName = lastSpeaker?.displayName || "the others";

    // Bug 4: Fetch recent conversation context
    const recentMessages = await db.select({
      displayName: users.displayName,
      content: messages.content,
    }).from(messages)
      .innerJoin(users, eq(messages.userId, users.id))
      .where(eq(messages.channelId, orch.channelId))
      .orderBy(desc(messages.createdAt))
      .limit(3);
    
    let recapLines = "";
    if (recentMessages.length > 0) {
      const lines = recentMessages.map(m => `- ${m.displayName}: "${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}"`).join("\n");
      recapLines = `\n\nRecent conversation:\n${lines}\n`;
    }

    switch (phase) {
      case "opening":
        nudgeContent = `@${agent.displayName} — what do you think? One or two sentences, keep it tight.${recapLines}`;
        break;
      case "debate":
        nudgeContent = `@${agent.displayName} —${recapLines}
thoughts? (keep it to 1-2 sentences)`;
        break;
      case "synthesis":
        nudgeContent = `@${agent.displayName} — we're wrapping up — one sentence to close it out.${recapLines}`;
        break;
    }

    // Bug 1: Use orch.createdBy instead of agent.userId
    const [msg] = await db.insert(messages).values({
      channelId: orch.channelId,
      userId: orch.createdBy,
      content: nudgeContent,
    }).returning();

    const [channel] = await db.select().from(channels).where(eq(channels.id, orch.channelId)).limit(1);
    if (channel) {
      await emitEvent(db, {
        channelId: orch.channelId,
        userId: orch.createdBy,
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

    // Bug 2: Mark pending nudge
    agent.pendingNudge = true;
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

  try {
    const { audioUrl, duration } = await generateTTS(msg.content, voice, msg.id);
    console.log(`[Huddle] TTS generated: audioUrl=${audioUrl} duration=${duration} msgId=${msg.id}`);

    await publishEvent({
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
    const next = getNextQuietAgent(orch);
    if (!next) return;
    await postTargetedNudge(orch, next);
  }, 45000);
}

export async function startOrchestrator(params: {
  huddleId: string;
  channelId: string;
  topic: string;
  agentNames: string[];
  maxDurationMs: number;
  createdBy: string;
  starter?: string | null;
}) {
  // Load agent participants with bios
  const agentParticipants = await db.select({
    userId: huddleParticipants.userId,
    displayName: users.displayName,
    bio: users.bio,
  }).from(huddleParticipants)
    .innerJoin(users, eq(huddleParticipants.userId, users.id))
    .where(and(eq(huddleParticipants.huddleId, params.huddleId), eq(huddleParticipants.role, "agent")));

  const orch: ActiveOrchestrator = {
    huddleId: params.huddleId,
    channelId: params.channelId,
    topic: params.topic,
    starter: params.starter || null,
    nudgeTimer: null,
    turnTimer: null,
    maxTimer: null,
    stopped: false,
    agents: agentParticipants.map(a => ({
      userId: a.userId,
      displayName: a.displayName,
      bio: a.bio,
      lastSpoke: 0,
      messageCount: 0,
      pendingNudge: false,
    })),
    lastSpeakerId: null,
    totalMessages: 0,
    startedAt: Date.now(),
    phase: "opening",
    createdBy: params.createdBy,
  };

  activeOrchestrators.set(params.huddleId, orch);
  huddleChannelMap.set(params.channelId, params.huddleId);

  // Assign angles
  const angles = assignAngles(params.topic, orch.agents);

  // Post initial message
  const starterLine = params.starter ? `\n\n💡 Starter: "${params.starter}"` : "";
  const initContent = `🎙️ Huddle started! "${params.topic}" — ${params.agentNames.join(", ")} are in.${starterLine}\n\nKeep responses SHORT — 1-2 sentences max. Who's got an opening take?`;

  const [msg] = await db.insert(messages).values({
    channelId: params.channelId,
    userId: params.createdBy,
    content: initContent,
  }).returning();

  await emitEvent(db, {
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

  // Post persona-aware prompts, staggered
  for (const agent of orch.agents) {
    await sleep(1000 + Math.random() * 1000);
    if (orch.stopped) break;

    const angle = angles.get(agent.userId) || "share your unique perspective";
    const promptContent = buildAgentPrompt(agent, params.topic, angle, params.starter || null, orch.agents);

    const [promptMsg] = await db.insert(messages).values({
      channelId: params.channelId,
      userId: params.createdBy,
      content: promptContent,
    }).returning();

    await emitEvent(db, {
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

    console.log(`[Huddle] Sent persona-aware prompt to ${agent.displayName} (angle: ${angle.substring(0, 50)}...)`);
  }

  resetNudgeTimer(orch);

  orch.maxTimer = setTimeout(async () => {
    if (orch.stopped) return;
    await endHuddle(params.huddleId, params.createdBy);
  }, params.maxDurationMs);

  await publishEvent({
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

    const closingContent = `🎙️ Huddle ended. Thanks for the conversation!`;
    const [msg] = await db.insert(messages).values({
      channelId: orch.channelId,
      userId: endedBy,
      content: closingContent,
    }).returning();

    await emitEvent(db, {
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

  await db.update(huddles).set({
    status: "ended",
    endedAt: new Date(),
  }).where(eq(huddles.id, huddleId));

  const [huddle] = await db.select().from(huddles).where(eq(huddles.id, huddleId)).limit(1);
  if (huddle) {
    await publishEvent({
      type: "huddle.ended",
      data: { huddleId },
    });
  }
}

export function isHuddleChannel(channelId: string): boolean {
  return huddleChannelMap.has(channelId);
}
