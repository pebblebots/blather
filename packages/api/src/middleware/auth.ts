import { createMiddleware } from 'hono/factory';
import jwt from 'jsonwebtoken';
import { eq, and, isNull } from 'drizzle-orm';
import { apiKeys } from '@blather/db';
import { createHash } from 'crypto';
import type { Env } from '../app.js';
import type { Db } from '@blather/db';
import { JWT_SECRET } from '../config.js';
import type { Context } from 'hono';

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function verifyBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}

export function logAuthFailure(
  c: Context,
  reason: string,
  extra?: { apiKeyPrefix?: string; email?: string },
) {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  console.warn(`[AUTH FAIL] ${reason} ip=${ip} path=${c.req.path}${extra?.email ? ` email=${extra.email}` : ''}${extra?.apiKeyPrefix ? ` key=${extra.apiKeyPrefix}…` : ''}`);
}

async function tryApiKey(db: Db, key: string): Promise<string | null> {
  const hash = hashApiKey(key);
  const [found] = await db.select().from(apiKeys).where(
    and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt))
  ).limit(1);
  if (!found) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, found.id));
  return found.userId;
}

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const db = c.get('db');
  const authHeader = c.req.header('Authorization');

  // 1. Try Bearer as JWT
  const bearerUserId = verifyBearerToken(authHeader);
  if (bearerUserId) {
    c.set('userId', bearerUserId);
    return next();
  }

  // 2. Try X-API-Key header
  const apiKeyHeader = c.req.header('X-API-Key');
  if (apiKeyHeader) {
    const userId = await tryApiKey(db, apiKeyHeader);
    if (userId) {
      c.set('userId', userId);
      return next();
    }
    logAuthFailure(c, 'invalid_api_key', { apiKeyPrefix: apiKeyHeader.slice(0, 12) });
    return c.json({ error: 'Invalid API key' }, 401);
  }

  // 3. Bearer token failed JWT parse — try it as an API key before rejecting.
  //    Agents that send `Authorization: Bearer blather_xxx` instead of `X-API-Key: blather_xxx`
  //    would otherwise get a hard 401 with no fallback.
  if (authHeader?.startsWith('Bearer ')) {
    const bearerValue = authHeader.slice(7);
    const userId = await tryApiKey(db, bearerValue);
    if (userId) {
      c.set('userId', userId);
      return next();
    }
    logAuthFailure(c, 'invalid_token');
    return c.json({ error: 'Invalid token' }, 401);
  }

  return c.json({ error: 'Authentication required' }, 401);
});
