import { Hono } from 'hono';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import {
  users, apiKeys, agents, workspaces, workspaceMembers,
  channels, channelMembers,
} from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware, hashApiKey } from '../middleware/auth.js';
import type { CreateAgentRequest, UpdateAgentRequest, AgentConfigBundle } from '@blather/types';

export const agentRoutes = new Hono<Env>();
agentRoutes.use('*', authMiddleware);

// ── Admin guard: checks caller is owner/admin of the workspace ──
async function requireAdmin(c: any, workspaceId: string): Promise<boolean> {
  const db = c.get('db');
  const userId = c.get('userId');
  const [membership] = await db.select().from(workspaceMembers)
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    )).limit(1);
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return false;
  }
  return true;
}

// Helper: resolve channel names/IDs to channel rows
async function resolveChannels(db: any, workspaceId: string, channelRefs: string[]) {
  const allChannels = await db.select().from(channels)
    .where(eq(channels.workspaceId, workspaceId));
  return channelRefs.map((ref: string) => {
    const clean = ref.replace(/^#/, '');
    return allChannels.find((ch: any) => ch.id === ref || ch.slug === clean || ch.name === clean);
  }).filter(Boolean);
}

// Helper: get agent's joined channels
async function getAgentChannels(db: any, userId: string, workspaceId: string) {
  const memberships = await db.select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, userId));
  if (memberships.length === 0) return [];
  const ids = memberships.map((m: any) => m.channelId);
  const chans = await db.select().from(channels)
    .where(and(eq(channels.workspaceId, workspaceId), inArray(channels.id, ids)));
  return chans.map((ch: any) => ({ id: ch.id, name: ch.name }));
}

// Helper: generate config bundle
function generateConfigBundle(agent: any, agentChannels: any[], workspaceName: string): AgentConfigBundle {
  const personality = (agent.personality as Record<string, any>) || {};

  const soulMd = `# SOUL.md - Who You Are
_You're ${agent.displayName || 'an agent'}. Own it._

## Bio
${agent.bio || 'No bio set.'}

## Personality
${Object.entries(personality).map(([k, v]) => `- **${k}**: ${v}`).join('\n') || '- Default personality'}
`;

  const agentsMd = `# AGENTS.md
## Workspace: ${workspaceName}
You are a registered agent in this workspace.
Your channels: ${agentChannels.map(ch => `#${ch.name}`).join(', ') || 'none'}
`;

  const heartbeatMd = `# HEARTBEAT.md
Heartbeat interval: ${agent.heartbeatInterval || 1800} seconds
Check your channels periodically and respond to messages.
If nothing needs attention, reply HEARTBEAT_OK.
`;

  const openclawJson = {
    agent: {
      id: agent.id,
      userId: agent.userId,
      displayName: agent.displayName,
      model: agent.model,
    },
    blather: {
      workspace: workspaceName,
      channels: agentChannels,
    },
    heartbeat: {
      intervalSeconds: agent.heartbeatInterval || 1800,
    },
    memory: agent.memoryConfig || {},
  };

  return {
    'openclaw.json': openclawJson,
    'SOUL.md': soulMd,
    'AGENTS.md': agentsMd,
    'HEARTBEAT.md': heartbeatMd,
  };
}

// ── POST /api/agents — Create agent ──
agentRoutes.post('/', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<CreateAgentRequest>();

  if (!body.workspaceId || !body.email || !body.displayName) {
    return c.json({ error: 'workspaceId, email, and displayName are required' }, 400);
  }

  if (!(await requireAdmin(c, body.workspaceId))) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  // Check email not already taken
  const [existingUser] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (existingUser) {
    return c.json({ error: 'Email already in use' }, 409);
  }

  // Create user (service account)
  const [user] = await db.insert(users).values({
    email: body.email,
    displayName: body.displayName,
    isAgent: true,
    bio: body.bio || null,
  }).returning();

  // Add to workspace as member
  await db.insert(workspaceMembers).values({
    workspaceId: body.workspaceId,
    userId: user.id,
    role: 'member',
  });

  // Create agent metadata
  const [agent] = await db.insert(agents).values({
    userId: user.id,
    workspaceId: body.workspaceId,
    displayName: body.displayName,
    bio: body.bio || null,
    personality: body.personality || {},
    model: body.model || null,
    heartbeatInterval: body.heartbeatInterval || 1800,
    memoryConfig: body.memory || {},
  }).returning();

  // Auto-join default channels
  const defaultChannels = await db.select().from(channels)
    .where(and(eq(channels.workspaceId, body.workspaceId), eq(channels.isDefault, true)));

  // Resolve requested channels
  const requestedChannels = body.channels ? await resolveChannels(db, body.workspaceId, body.channels) : [];

  // Merge and deduplicate
  const allChannelsToJoin = [...defaultChannels];
  for (const ch of requestedChannels) {
    if (!allChannelsToJoin.find((c: any) => c.id === ch.id)) {
      allChannelsToJoin.push(ch);
    }
  }

  // Join channels
  for (const ch of allChannelsToJoin) {
    await db.insert(channelMembers).values({
      channelId: ch.id,
      userId: user.id,
    }).onConflictDoNothing();
  }

  // Generate API key
  const rawKey = `blather_${randomBytes(32).toString('hex')}`;
  const keyHash = hashApiKey(rawKey);
  await db.insert(apiKeys).values({
    userId: user.id,
    keyHash,
    name: `agent-${agent.id}`,
  });

  // Get workspace name for config
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspaceId)).limit(1);
  const agentChannels = allChannelsToJoin.map((ch: any) => ({ id: ch.id, name: ch.name }));
  const config = generateConfigBundle({ ...agent, userId: user.id }, agentChannels, ws?.name || 'unknown');

  return c.json({
    id: agent.id,
    userId: user.id,
    workspaceId: agent.workspaceId,
    displayName: agent.displayName,
    bio: agent.bio,
    personality: agent.personality,
    model: agent.model,
    heartbeatInterval: agent.heartbeatInterval,
    memoryConfig: agent.memoryConfig,
    status: agent.status,
    channels: agentChannels,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    apiKey: rawKey,
    email: user.email,
    config,
  }, 201);
});

// ── GET /api/agents — List agents ──
agentRoutes.get('/', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');

  // Find workspaces the user is admin/owner of
  const memberships = await db.select().from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  const adminWsIds = memberships
    .filter((m: any) => m.role === 'owner' || m.role === 'admin')
    .map((m: any) => m.workspaceId);

  if (adminWsIds.length === 0) return c.json([]);

  const agentList = await db.select().from(agents)
    .where(inArray(agents.workspaceId, adminWsIds));

  return c.json(agentList);
});

// ── GET /api/agents/:id — Get agent details ──
agentRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  if (!(await requireAdmin(c, agent.workspaceId))) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const agentChannels = await getAgentChannels(db, agent.userId, agent.workspaceId);

  return c.json({
    ...agent,
    channels: agentChannels,
  });
});

// ── GET /api/agents/:id/config — Config bundle ──
agentRoutes.get('/:id/config', async (c) => {
  const db = c.get('db');
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  if (!(await requireAdmin(c, agent.workspaceId))) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, agent.workspaceId)).limit(1);
  const agentChannels = await getAgentChannels(db, agent.userId, agent.workspaceId);
  const config = generateConfigBundle(agent, agentChannels, ws?.name || 'unknown');

  return c.json(config);
});

// ── PATCH /api/agents/:id — Update agent ──
agentRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const agentId = c.req.param('id');
  const body = await c.req.json<UpdateAgentRequest>();

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  if (!(await requireAdmin(c, agent.workspaceId))) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  // Build update object
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.bio !== undefined) updates.bio = body.bio;
  if (body.personality !== undefined) updates.personality = body.personality;
  if (body.model !== undefined) updates.model = body.model;
  if (body.heartbeatInterval !== undefined) updates.heartbeatInterval = body.heartbeatInterval;
  if (body.memory !== undefined) updates.memoryConfig = body.memory;

  const [updated] = await db.update(agents).set(updates).where(eq(agents.id, agentId)).returning();

  // Update user record too
  const userUpdates: Record<string, any> = {};
  if (body.displayName !== undefined) userUpdates.displayName = body.displayName;
  if (body.bio !== undefined) userUpdates.bio = body.bio;
  if (Object.keys(userUpdates).length > 0) {
    await db.update(users).set(userUpdates).where(eq(users.id, agent.userId));
  }

  // Update channel memberships if provided
  if (body.channels !== undefined) {
    // Remove all current channel memberships in this workspace
    const wsChannels = await db.select().from(channels)
      .where(eq(channels.workspaceId, agent.workspaceId));
    const wsChannelIds = wsChannels.map((ch: any) => ch.id);
    if (wsChannelIds.length > 0) {
      for (const chId of wsChannelIds) {
        await db.delete(channelMembers).where(
          and(eq(channelMembers.channelId, chId), eq(channelMembers.userId, agent.userId))
        );
      }
    }

    // Re-add default channels + requested
    const defaultChannels = wsChannels.filter((ch: any) => ch.isDefault);
    const requestedChannels = await resolveChannels(db, agent.workspaceId, body.channels);
    const allToJoin = [...defaultChannels];
    for (const ch of requestedChannels) {
      if (!allToJoin.find((c: any) => c.id === ch.id)) allToJoin.push(ch);
    }
    for (const ch of allToJoin) {
      await db.insert(channelMembers).values({
        channelId: ch.id,
        userId: agent.userId,
      }).onConflictDoNothing();
    }
  }

  const agentChannels = await getAgentChannels(db, agent.userId, agent.workspaceId);
  return c.json({ ...updated, channels: agentChannels });
});

// ── DELETE /api/agents/:id — Deregister agent ──
agentRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  if (!(await requireAdmin(c, agent.workspaceId))) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  // Revoke all API keys for this user
  await db.update(apiKeys).set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.userId, agent.userId), isNull(apiKeys.revokedAt)));

  // Remove channel memberships in this workspace
  const wsChannels = await db.select({ id: channels.id }).from(channels)
    .where(eq(channels.workspaceId, agent.workspaceId));
  for (const ch of wsChannels) {
    await db.delete(channelMembers).where(
      and(eq(channelMembers.channelId, ch.id), eq(channelMembers.userId, agent.userId))
    );
  }

  // Remove workspace membership
  await db.delete(workspaceMembers).where(
    and(eq(workspaceMembers.workspaceId, agent.workspaceId), eq(workspaceMembers.userId, agent.userId))
  );

  // Mark user as not agent (keep for audit)
  await db.update(users).set({ isAgent: false }).where(eq(users.id, agent.userId));

  // Delete agent row
  await db.delete(agents).where(eq(agents.id, agentId));

  return c.body(null, 204);
});
