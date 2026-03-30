import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { incidents } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';

export const incidentRoutes = new Hono<Env>();
incidentRoutes.use('*', authMiddleware);

// List incidents
incidentRoutes.get('/', async (c) => {
  const db = c.get('db');

  const conditions: any[] = [];
  const status = c.req.query('status');
  if (status) conditions.push(eq(incidents.status, status as any));
  const severity = c.req.query('severity');
  if (severity) conditions.push(eq(incidents.severity, severity as any));

  const results = await db.select().from(incidents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(incidents.createdAt));

  return c.json(results);
});

// Get single incident
incidentRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [incident] = await db.select().from(incidents).where(eq(incidents.id, id));
  if (!incident) return c.json({ error: 'Incident not found' }, 404);

  return c.json(incident);
});

// Create incident
incidentRoutes.post('/', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');

  const body = await c.req.json<{
    title: string;
    severity?: 'critical' | 'warning' | 'info';
    channelId?: string;
  }>();

  const { title, severity = 'warning', channelId } = body;
  if (!title) return c.json({ error: 'title required' }, 400);

  const [incident] = await db.insert(incidents).values({
    title,
    severity,
    openedBy: userId,
    channelId,
  }).returning();

  return c.json(incident, 201);
});

// Update incident
incidentRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{
    status?: 'open' | 'acked' | 'resolved';
    resolution?: string;
    severity?: 'critical' | 'warning' | 'info';
  }>();

  const updates: any = { updatedAt: new Date() };

  if (body.status) {
    updates.status = body.status;
    if (body.status === 'acked') {
      updates.ackedBy = userId;
      updates.ackedAt = new Date();
    } else if (body.status === 'resolved') {
      updates.resolvedBy = userId;
      updates.resolvedAt = new Date();
    }
  }

  if (body.severity) updates.severity = body.severity;
  if (body.resolution) updates.resolution = body.resolution;

  const [incident] = await db.update(incidents).set(updates).where(eq(incidents.id, id)).returning();
  if (!incident) return c.json({ error: 'Incident not found' }, 404);

  return c.json(incident);
});
