import { Hono } from 'hono';
import { users } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';

export const memberRoutes = new Hono<Env>();
memberRoutes.use('*', authMiddleware);

// List all users
memberRoutes.get('/', async (c) => {
  const db = c.get('db');

  const members = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      isAgent: users.isAgent,
      avatarUrl: users.avatarUrl,
    })
    .from(users);

  return c.json(members);
});
