import { Hono } from 'hono';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { users, apiKeys, magicTokens, workspaces, workspaceMembers, channels, channelMembers } from '@blather/db';
import type { Env } from '../app.js';
import { signToken, hashApiKey, authMiddleware } from '../middleware/auth.js';
import type { RegisterRequest, LoginRequest, CreateApiKeyRequest } from '@blather/types';

export const authRoutes = new Hono<Env>();

// ── Helper: extract domain from email ──
function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

// ── Helper: auto-join workspaces that allow this domain ──
async function autoJoinDomainWorkspaces(db: any, userId: string, email: string) {
  const domain = emailDomain(email);
  if (!domain) return;

  const allWorkspaces = await db.select().from(workspaces);
  for (const ws of allWorkspaces) {
    const domains: string[] = (ws.allowedDomains as string[]) || [];
    if (domains.map((d: string) => d.toLowerCase()).includes(domain)) {
      // Check if already a member
      const existing = await db.select().from(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, ws.id),
          eq(workspaceMembers.userId, userId)
        )).limit(1);
      if (existing.length === 0) {
        await db.insert(workspaceMembers).values({
          workspaceId: ws.id,
          userId,
          role: 'member',
        });

        // Auto-join to default channels in this workspace
        const defaultChannels = await db.select().from(channels)
          .where(and(
            eq(channels.workspaceId, ws.id),
            eq(channels.isDefault, true)
          ));

        for (const channel of defaultChannels) {
          // Check if already a member of this channel
          const existingChannelMember = await db.select().from(channelMembers)
            .where(and(
              eq(channelMembers.channelId, channel.id),
              eq(channelMembers.userId, userId)
            )).limit(1);
          
          if (existingChannelMember.length === 0) {
            await db.insert(channelMembers).values({
              channelId: channel.id,
              userId,
            });
          }
        }
      }
    }
  }
}

// ── Magic Link: Request ──
authRoutes.post('/magic', async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  const db = c.get('db');

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email required' }, 400);
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  await db.insert(magicTokens).values({
    email: email.toLowerCase(),
    token,
    expiresAt,
  });

  // In production, send an email. For now, log + return it in response (dev mode).
  const magicUrl = `${c.req.header('origin') || 'http://localhost:8080'}/auth/verify?token=${token}`;
  console.log(`[MAGIC LINK] ${email} → ${magicUrl}`);

  return c.json({
    ok: true,
    message: 'Magic link sent (check console in dev mode)',
    // DEV ONLY — remove in production:
    _dev: { token, url: magicUrl },
  });
});

// ── Magic Link: Verify ──
authRoutes.post('/magic/verify', async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  const db = c.get('db');

  const [magic] = await db.select().from(magicTokens)
    .where(and(
      eq(magicTokens.token, token),
      isNull(magicTokens.usedAt),
      gt(magicTokens.expiresAt, new Date()),
    )).limit(1);

  if (!magic) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // Mark as used
  await db.update(magicTokens).set({ usedAt: new Date() }).where(eq(magicTokens.id, magic.id));

  // Find or create user
  let [user] = await db.select().from(users).where(eq(users.email, magic.email)).limit(1);

  if (!user) {
    // Auto-create user from email
    const name = magic.email.split('@')[0];
    [user] = await db.insert(users).values({
      email: magic.email,
      displayName: name,
      isAgent: false,
    }).returning();
  }

  // Auto-join domain workspaces
  await autoJoinDomainWorkspaces(db, user.id, user.email);

  const jwt = signToken(user.id);
  return c.json({
    token: jwt,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isAgent: user.isAgent,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

// ── Legacy: Register (kept for agents) ──
authRoutes.post('/register', async (c) => {
  const body = await c.req.json<RegisterRequest>();
  const db = c.get('db');

  const passwordHash = body.password ? await bcrypt.hash(body.password, 12) : null;
  const [user] = await db.insert(users).values({
    email: body.email,
    passwordHash,
    displayName: body.displayName,
    isAgent: body.isAgent ?? false,
  }).returning();

  // Auto-join domain workspaces
  await autoJoinDomainWorkspaces(db, user.id, user.email);

  const token = signToken(user.id);
  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isAgent: user.isAgent,
      createdAt: user.createdAt.toISOString(),
    },
  }, 201);
});

// ── Legacy: Login (kept for agents with passwords) ──
authRoutes.post('/login', async (c) => {
  const body = await c.req.json<LoginRequest>();
  const db = c.get('db');

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!user || !user.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash))) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const token = signToken(user.id);
  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isAgent: user.isAgent,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

// ── Create API Key (authenticated) ──
authRoutes.post('/api-keys', authMiddleware, async (c) => {
  const body = await c.req.json<CreateApiKeyRequest>();
  const db = c.get('db');
  const userId = c.get('userId');

  const rawKey = `blather_${randomBytes(32).toString('hex')}`;
  const [created] = await db.insert(apiKeys).values({
    userId,
    keyHash: hashApiKey(rawKey),
    name: body.name,
  }).returning();

  return c.json({
    id: created.id,
    name: created.name,
    key: rawKey,
    createdAt: created.createdAt.toISOString(),
  }, 201);
});
