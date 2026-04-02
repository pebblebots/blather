import { Hono } from 'hono';
import { eq, isNull, and } from 'drizzle-orm';
import { users } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';

export const memberRoutes = new Hono<Env>();
memberRoutes.use('*', authMiddleware);

// List all users
memberRoutes.get('/', async (c) => {
  const db = c.get('db');
  const includeDeactivated = c.req.query('includeDeactivated') === 'true';

  let where = undefined;

  if (includeDeactivated) {
    const userId = c.get('userId');
    const [requester] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId));

    if (!requester || (requester.role !== 'admin' && requester.role !== 'owner')) {
      where = isNull(users.deactivatedAt);
    }
  } else {
    where = isNull(users.deactivatedAt);
  }

  const members = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      isAgent: users.isAgent,
      avatarUrl: users.avatarUrl,
      deactivatedAt: users.deactivatedAt,
    })
    .from(users)
    .where(where);

  return c.json(members);
});

// Deactivate a user
memberRoutes.patch('/:id/deactivate', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const targetId = c.req.param('id');

  const [requester] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId));

  if (!requester || (requester.role !== 'admin' && requester.role !== 'owner')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetId));

  if (!target) {
    return c.json({ error: 'User not found' }, 404);
  }

  const [updated] = await db
    .update(users)
    .set({ deactivatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning({ id: users.id, deactivatedAt: users.deactivatedAt });

  return c.json(updated);
});

// Reactivate a user
memberRoutes.patch('/:id/reactivate', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const targetId = c.req.param('id');

  const [requester] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId));

  if (!requester || (requester.role !== 'admin' && requester.role !== 'owner')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetId));

  if (!target) {
    return c.json({ error: 'User not found' }, 404);
  }

  const [updated] = await db
    .update(users)
    .set({ deactivatedAt: null })
    .where(eq(users.id, targetId))
    .returning({ id: users.id, deactivatedAt: users.deactivatedAt });

  return c.json(updated);
});
