import { Hono } from 'hono';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import { clearAgentStatus, getAllStatuses, setAgentStatus, type AgentStatus } from '../state/agentStatus.js';
import { broadcastStatusForUser } from '../ws/manager.js';

type StatusRequestBody = {
  text?: unknown;
  autoclear?: string;
  progress?: number;
  eta?: string;
};

function normalizeStatusText(text: unknown): string | null {
  if (typeof text !== 'string') {
    return null;
  }

  const normalizedText = text.trim();
  return normalizedText.length > 0 ? normalizedText : null;
}

function toBroadcastStatus(status: AgentStatus): { text: string; progress?: number; eta?: string } {
  return {
    text: status.text,
    ...(status.progress != null ? { progress: status.progress } : {}),
    ...(status.eta ? { eta: status.eta } : {}),
  };
}

export const statusRoutes = new Hono<Env>();
statusRoutes.use('*', authMiddleware);

statusRoutes.put('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<StatusRequestBody>();
  const text = normalizeStatusText(body.text);

  if (!text) {
    return c.json({ error: 'text is required' }, 400);
  }

  if (body.progress != null && (typeof body.progress !== 'number' || body.progress < 0 || body.progress > 1)) {
    return c.json({ error: 'progress must be a number between 0 and 1' }, 400);
  }

  const status = setAgentStatus(
    userId,
    text,
    {
      autoclear: body.autoclear ?? '1m',
      progress: body.progress,
      eta: body.eta,
    },
    (clearedUserId) => {
      broadcastStatusForUser(clearedUserId, null);
    },
  );

  broadcastStatusForUser(userId, toBroadcastStatus(status));
  return c.json({ ok: true, status });
});

statusRoutes.delete('/', async (c) => {
  const userId = c.get('userId');
  clearAgentStatus(userId);
  broadcastStatusForUser(userId, null);
  return c.json({ ok: true });
});

statusRoutes.get('/', async (c) => {
  return c.json(Object.fromEntries(getAllStatuses()));
});
