import { createMiddleware } from 'hono/factory';
import jwt from 'jsonwebtoken';
import { eq, and, isNull } from 'drizzle-orm';
import { apiKeys } from '@blather/db';
import { createHash } from 'crypto';
import type { Env } from '../app.js';

const JWT_SECRET = process.env.JWT_SECRET || 'blather-dev-secret-change-in-production';

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const db = c.get('db');

  // Try Bearer token first
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { sub: string };
      c.set('userId', payload.sub);
      return next();
    } catch {
      return c.json({ error: 'Invalid token' }, 401);
    }
  }

  // Try API key
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

  return c.json({ error: 'Authentication required' }, 401);
});
