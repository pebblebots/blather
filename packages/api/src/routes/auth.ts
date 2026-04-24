import { Hono } from 'hono';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { users, apiKeys, magicTokens, channels, channelMembers } from '@blather/db';
import type { Env } from '../app.js';
import { signToken, hashApiKey, authMiddleware, logAuthFailure } from '../middleware/auth.js';
import type { LoginRequest, CreateApiKeyRequest } from '@blather/types';
import type { Db } from '@blather/db';
import { Resend } from 'resend';
import { publishEvent } from '../ws/manager.js';
import { authMagicLimiter, authVerifyLimiter, type RateLimitStore } from '../middleware/rate-limit.js';
import { sendTourGuideWelcome } from '../onboarding/tourGuide.js';

/** Map a DB user row to the public JSON shape returned by auth endpoints. */
function userToPublic(user: { id: string; email: string; displayName: string; avatarUrl: string | null; isAgent: boolean; role: string; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isAgent: user.isAgent,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ── Helper: check email against BLA_ALLOWED_EMAILS allowlist ──
// If BLA_ALLOWED_EMAILS is not set, email-based login is disabled entirely.
function isEmailAllowed(email: string): boolean {
  const raw = process.env.BLA_ALLOWED_EMAILS;
  if (!raw) return false; // no allowlist = email login disabled

  const patterns = raw.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
  if (patterns.length === 0) return false;

  const lower = email.toLowerCase();
  return patterns.some(pattern => {
    // Convert wildcard pattern to regex: escape dots, replace * with .*
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(lower);
  });
}

// ── Helper: extract domain from email ──
function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

// ── Helper: auto-join default channels for new users ──
async function autoJoinDefaultChannels(db: Db, userId: string) {
  const defaultChannels = await db.select().from(channels)
    .where(eq(channels.isDefault, true));

  for (const channel of defaultChannels) {
    const [existing] = await db.select().from(channelMembers)
      .where(and(
        eq(channelMembers.channelId, channel.id),
        eq(channelMembers.userId, userId)
      )).limit(1);

    if (!existing) {
      await db.insert(channelMembers).values({
        channelId: channel.id,
        userId,
      }).onConflictDoNothing();
    }
  }

  // Broadcast member.joined so other clients update their sidebar
  const [joinedUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (joinedUser) {
    await publishEvent({
      type: 'member.joined',
      channel_id: null,
      data: {
        id: joinedUser.id,
        displayName: joinedUser.displayName,
        email: joinedUser.email,
        isAgent: joinedUser.isAgent,
        avatarUrl: joinedUser.avatarUrl,
      },
    });

    // Send Tour Guide welcome DM to new human users
    await sendTourGuideWelcome(db, userId, joinedUser.isAgent);
  }
}

export function createAuthRoutes(rateLimitStore?: RateLimitStore): Hono<Env> {
  const authRoutes = new Hono<Env>();

// ── Magic Link: Request ──
authRoutes.post('/magic', authMagicLimiter(rateLimitStore), async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  const db = c.get('db');

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email required' }, 400);
  }

  if (!isEmailAllowed(email)) {
    return c.json({ error: 'Email not allowed' }, 403);
  }

  const token = randomBytes(32).toString('hex');
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  await db.insert(magicTokens).values({
    email: email.toLowerCase(),
    token,
    code,
    expiresAt,
  });

  const magicUrl = `${process.env.APP_URL || c.req.header('origin') || 'http://localhost:8080'}/auth/verify?token=${token}`;
  console.log(`[MAGIC LINK] ${email} → ${magicUrl}`);
  console.log(`[MAGIC CODE] ${email} → ${code}`);

  // Send the magic link email
  const resend = getResend();
  if (resend) {
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM || 'yappers <noreply@localhost>',
        to: email.toLowerCase(),
        subject: 'Your yappers login link',
        html: `<p>Click the link below to log in to yappers:</p><p><a href="${magicUrl}">${magicUrl}</a></p><p>Or enter this code in the app: <strong>${code}</strong></p><p>This link expires in 15 minutes.</p>`,
      });
    } catch (err) {
      console.error('[MAGIC LINK] Email send failed:', err);
    }
  }

  // If no Resend key, log the magic link server-side only
  if (!getResend()) {
    console.log(`[MAGIC LINK] No email provider configured. Magic URL: ${magicUrl}`);
  }

  // Dev/test helper: when running without an email provider AND not in production,
  // return the token in the response so local dev and e2e tests can complete the
  // magic-link flow without a real inbox. Double-gated on purpose: never returns
  // tokens in production, and never returns tokens when email is actually working.
  const isProduction = process.env.NODE_ENV === 'production';
  const expose = !isProduction && !getResend();
  return c.json({
    ok: true,
    message: 'Magic link sent! Check your email.',
    ...(expose ? { _dev: { token, code } } : {}),
  });
});

// ── Magic Link: Verify ──
authRoutes.post('/magic/verify', authVerifyLimiter(rateLimitStore), async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  const db = c.get('db');

  const [magic] = await db.select().from(magicTokens)
    .where(and(
      eq(magicTokens.token, token),
      isNull(magicTokens.usedAt),
      gt(magicTokens.expiresAt, new Date()),
    )).limit(1);

  if (!magic) {
    logAuthFailure(c, 'invalid_magic_token');
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
  await autoJoinDefaultChannels(db, user.id);

  const jwt = signToken(user.id);
  return c.json({ token: jwt, user: userToPublic(user) });
});

// ── Magic Code: Verify ──
authRoutes.post('/magic/verify-code', authVerifyLimiter(rateLimitStore), async (c) => {
  const { email, code } = await c.req.json<{ email: string; code: string }>();
  const db = c.get('db');

  if (!email || !code || code.length !== 6) {
    return c.json({ error: 'Valid email and 6-digit code required' }, 400);
  }

  const [magic] = await db.select().from(magicTokens)
    .where(and(
      eq(magicTokens.email, email.toLowerCase()),
      eq(magicTokens.code, code),
      isNull(magicTokens.usedAt),
      gt(magicTokens.expiresAt, new Date()),
    )).limit(1);

  if (!magic) {
    logAuthFailure(c, 'invalid_magic_code', { email: email.toLowerCase() });
    return c.json({ error: 'Invalid or expired code' }, 401);
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
  await autoJoinDefaultChannels(db, user.id);

  const jwt = signToken(user.id);
  return c.json({ token: jwt, user: userToPublic(user) });
});


// ── Legacy: Login (kept for agents with passwords) ──
authRoutes.post('/login', async (c) => {
  const body = await c.req.json<LoginRequest>();
  const db = c.get('db');

  if (!isEmailAllowed(body.email)) {
    return c.json({ error: 'Email not allowed' }, 403);
  }

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!user || !user.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash))) {
    logAuthFailure(c, 'invalid_credentials', { email: body.email });
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

// ── Get current user (authenticated) ──
authRoutes.get("/me", authMiddleware, async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(userToPublic(user));
});

  return authRoutes;
}

/** Default instance for production use. */
export const authRoutes = createAuthRoutes();
