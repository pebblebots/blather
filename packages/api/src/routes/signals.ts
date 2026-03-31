import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { signalConvergences, signalEntities } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import { ingestWatchlist, ingestSignal, getConvergences } from '../signals/entity-linker.js';

export const signalRoutes = new Hono<Env>();
signalRoutes.use('*', authMiddleware);

// POST /api/signals/watchlist — ingest JSON-lines watchlist
signalRoutes.post('/watchlist', async (c) => {
  const db = c.get('db');
  const body = await c.req.text();
  if (!body.trim()) return c.json({ error: 'body required (JSON-lines)' }, 400);

  const result = await ingestWatchlist(db, body);
  return c.json(result, 201);
});

// POST /api/signals/events — ingest a single signal event
signalRoutes.post('/events', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();

  if (!body.source || !body.signalType || body.confidence == null || !body.observedAt) {
    return c.json({ error: 'source, signalType, confidence, and observedAt are required' }, 400);
  }

  if (!body.entityId && !body.entityName) {
    return c.json({ error: 'entityId or entityName required' }, 400);
  }

  try {
    const result = await ingestSignal(db, body);
    return c.json(result, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 422);
  }
});

// GET /api/signals/convergences — list convergences
signalRoutes.get('/convergences', async (c) => {
  const db = c.get('db');
  const unposted = c.req.query('unposted') === 'true';
  const rows = await getConvergences(db, { unposted });

  // Enrich with entity name
  const entityIds = [...new Set(rows.map((r: any) => r.entityId))];
  const entities = entityIds.length > 0
    ? await db.select().from(signalEntities)
    : [];
  const entityMap = new Map(entities.map((e: any) => [e.id, e.name]));

  const enriched = rows.map((r: any) => ({
    ...r,
    entityName: entityMap.get(r.entityId) || null,
  }));

  return c.json(enriched);
});

// POST /api/signals/convergences/:id/post — mark as posted
signalRoutes.post('/convergences/:id/post', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [conv] = await db.select().from(signalConvergences)
    .where(eq(signalConvergences.id, id))
    .limit(1);

  if (!conv) return c.json({ error: 'convergence not found' }, 404);
  if (conv.postedToSourcing) return c.json({ error: 'already posted' }, 409);

  // Get entity name for summary
  const [entity] = await db.select().from(signalEntities)
    .where(eq(signalEntities.id, conv.entityId))
    .limit(1);

  const summary = `🔔 Signal convergence detected for ${entity?.name || 'unknown entity'} — score ${conv.convergenceScore.toFixed(2)}, ${conv.signalEventIds.length} signals in window ${new Date(conv.windowStart).toISOString().slice(0, 10)} → ${new Date(conv.windowEnd).toISOString().slice(0, 10)}`;

  await db.update(signalConvergences)
    .set({ postedToSourcing: true })
    .where(eq(signalConvergences.id, id));

  return c.json({ posted: true, summary });
});
