import { Hono } from 'hono';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import { setAgentStatus, clearAgentStatus, getAgentStatus, getAllStatuses } from '../state/agentStatus.js';
import { broadcastStatusForUser } from '../ws/manager.js';

export const statusRoutes = new Hono<Env>();
statusRoutes.use('*', authMiddleware);

// Set status for the authenticated user
statusRoutes.put('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    text: string;
    autoclear?: string;
    progress?: number;
    eta?: string;
  }>();

  if (!body.text || typeof body.text !== 'string') {
    return c.json({ error: 'text is required' }, 400);
  }
  if (body.progress != null && (typeof body.progress !== 'number' || body.progress < 0 || body.progress > 1)) {
    return c.json({ error: 'progress must be a number between 0 and 1' }, 400);
  }

  const status = setAgentStatus(userId, body.text, {
    autoclear: body.autoclear ?? "1m",
    progress: body.progress,
    eta: body.eta,
  }, (clearedUserId) => {
    // Autoclear callback — broadcast the clear
    broadcastStatusForUser(clearedUserId, null);
  });

  broadcastStatusForUser(userId, {
    text: status.text,
    ...(status.progress != null ? { progress: status.progress } : {}),
    ...(status.eta ? { eta: status.eta } : {}),
  });

  return c.json({ ok: true, status });
});

// Clear status for the authenticated user
statusRoutes.delete('/', async (c) => {
  const userId = c.get('userId');
  clearAgentStatus(userId);
  broadcastStatusForUser(userId, null);
  return c.json({ ok: true });
});

// Get status for a specific user (optional convenience endpoint)
statusRoutes.get('/:userId', async (c) => {
  const status = getAgentStatus(c.req.param('userId'));
  return c.json({ status: status ?? null });
});

// Get all active statuses (for initial page load)
statusRoutes.get('/', async (c) => {
  const all = getAllStatuses();
  const result: Record<string, any> = {};
  for (const [userId, status] of all) {
    result[userId] = status;
  }
  return c.json(result);
});
