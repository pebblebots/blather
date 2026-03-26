import { createMiddleware } from 'hono/factory';
import jwt from 'jsonwebtoken';
import { eq, and, isNull } from 'drizzle-orm';
import { apiKeys } from '@blather/db';
import { createHash } from 'crypto';
import type { Env } from '../app.js';
import { JWT_SECRET } from '../config.js';

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

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const db = c.get('db');
  const authHeader = c.req.header('Authorization');
  const bearerUserId = verifyBearerToken(authHeader);

  if (bearerUserId) {
    c.set('userId', bearerUserId);
    return next();
  }

  const apiKey = c.req.header('X-API-Key');
  if (apiKey) {
    const hash = hashApiKey(apiKey);
    const [found] = await db.select().from(apiKeys).where(
      and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt))
    ).limit(1);
    if (found) {
      // Update last_used_at
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, found.id));
      c.set('userId', found.userId);
      return next();
    }
    return c.json({ error: 'Invalid API key' }, 401);
  }

  if (authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  return c.json({ error: 'Authentication required' }, 401);
});
