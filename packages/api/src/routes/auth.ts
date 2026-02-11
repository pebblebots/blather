import { Hono } from 'hono';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { users, apiKeys } from '@blather/db';
import type { Env } from '../app.js';
import { signToken, hashApiKey, authMiddleware } from '../middleware/auth.js';
import type { RegisterRequest, LoginRequest, CreateApiKeyRequest } from '@blather/types';

export const authRoutes = new Hono<Env>();

// Register
authRoutes.post('/register', async (c) => {
  const body = await c.req.json<RegisterRequest>();
  const db = c.get('db');

  const passwordHash = await bcrypt.hash(body.password, 12);
  const [user] = await db.insert(users).values({
    email: body.email,
    passwordHash,
    displayName: body.displayName,
    isAgent: body.isAgent ?? false,
  }).returning();

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

// Login
authRoutes.post('/login', async (c) => {
  const body = await c.req.json<LoginRequest>();
  const db = c.get('db');

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
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

// Create API Key (authenticated)
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
