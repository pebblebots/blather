import { Hono } from 'hono';
import { eq, and, desc, gte, lte, sql, ilike, or } from 'drizzle-orm';
import {
  signalEntities,
  signalEvents,
  signalConvergences,
  signalEntityTypeEnum,
  signalSourceEnum,
  signalTypeEnum,
} from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';

// ── Fuzzy matching ────────────────────────────────────────────────────────────

/** Normalized bigram set for a string. */
function bigrams(s: string): Set<string> {
  const norm = s.toLowerCase().trim();
  const bg = new Set<string>();
  for (let i = 0; i < norm.length - 1; i++) {
    bg.add(norm.slice(i, i + 2));
  }
  return bg;
}

/** Sørensen–Dice similarity coefficient between two strings. */
function diceCoefficient(a: string, b: string): number {
  const bg1 = bigrams(a);
  const bg2 = bigrams(b);
  if (bg1.size === 0 && bg2.size === 0) return 1;
  if (bg1.size === 0 || bg2.size === 0) return 0;
  let intersection = 0;
  for (const bg of bg1) {
    if (bg2.has(bg)) intersection++;
  }
  return (2 * intersection) / (bg1.size + bg2.size);
}

const FUZZY_THRESHOLD = 0.8;

/** Find the best matching entity for a name. Returns [entity, score] or null. */
async function fuzzyMatchEntity(
  db: any,
  name: string,
): Promise<{ entity: typeof signalEntities.$inferSelect; score: number } | null> {
  const allEntities = await db.select().from(signalEntities);
  let bestMatch: typeof signalEntities.$inferSelect | null = null;
  let bestScore = 0;

  for (const entity of allEntities) {
    // Check against primary name
    let score = diceCoefficient(name, entity.name);
    // Check against aliases
    if (entity.aliases && Array.isArray(entity.aliases)) {
      for (const alias of entity.aliases) {
        const aliasScore = diceCoefficient(name, alias);
        if (aliasScore > score) score = aliasScore;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entity;
    }
  }

  if (bestMatch && bestScore >= FUZZY_THRESHOLD) {
    return { entity: bestMatch, score: bestScore };
  }
  return null;
}

// ── Convergence detection ─────────────────────────────────────────────────────

const CONVERGENCE_WINDOW_DAYS = 90;

async function checkAndUpdateConvergence(db: any, entityId: string): Promise<void> {
  const windowEnd = new Date();
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - CONVERGENCE_WINDOW_DAYS);

  // Get events in the window
  const recentEvents = await db
    .select()
    .from(signalEvents)
    .where(
      and(
        eq(signalEvents.entityId, entityId),
        gte(signalEvents.observedAt, windowStart),
        lte(signalEvents.observedAt, windowEnd),
      ),
    );

  // Need 2+ events from different sources
  const distinctSources = new Set(recentEvents.map((e: any) => e.source));
  if (recentEvents.length < 2 || distinctSources.size < 2) return;

  // Calculate convergence score: (distinct sources * event count) / days_in_window, capped at 1.0
  const score = Math.min(1.0, (distinctSources.size * recentEvents.length) / CONVERGENCE_WINDOW_DAYS);
  const eventIds = recentEvents.map((e: any) => e.id);

  // Check for existing convergence on this entity
  const [existing] = await db
    .select()
    .from(signalConvergences)
    .where(eq(signalConvergences.entityId, entityId))
    .orderBy(desc(signalConvergences.createdAt))
    .limit(1);

  if (existing) {
    await db
      .update(signalConvergences)
      .set({
        signalEventIds: eventIds,
        convergenceScore: score,
        windowStart,
        windowEnd,
      })
      .where(eq(signalConvergences.id, existing.id));
  } else {
    await db.insert(signalConvergences).values({
      entityId,
      signalEventIds: eventIds,
      convergenceScore: score,
      windowStart,
      windowEnd,
    });
  }
}

// ── Entity linker: link event to entity (fuzzy match or create) ───────────────

async function linkEventToEntity(
  db: any,
  entityName: string,
  entityType: 'company' | 'person',
  event: {
    source: string;
    signalType: string;
    rawData: Record<string, unknown>;
    confidence: number;
    observedAt: Date;
  },
): Promise<{ entityId: string; eventId: string; matched: boolean }> {
  // Try fuzzy match
  const match = await fuzzyMatchEntity(db, entityName);

  let entityId: string;
  let matched = false;

  if (match) {
    entityId = match.entity.id;
    matched = true;
  } else {
    // Create new entity
    const [newEntity] = await db
      .insert(signalEntities)
      .values({ entityType, name: entityName })
      .returning({ id: signalEntities.id });
    entityId = newEntity.id;
  }

  // Create the event
  const [newEvent] = await db
    .insert(signalEvents)
    .values({
      entityId,
      source: event.source,
      signalType: event.signalType,
      rawData: event.rawData,
      confidence: event.confidence,
      observedAt: event.observedAt,
    })
    .returning({ id: signalEvents.id });

  // Check convergence
  await checkAndUpdateConvergence(db, entityId);

  return { entityId, eventId: newEvent.id, matched };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const signalRoutes = new Hono<Env>();
signalRoutes.use('*', authMiddleware);

// GET /signals/entities — list entities (with search/filter)
signalRoutes.get('/entities', async (c) => {
  const db = c.get('db');
  const search = c.req.query('search');
  const entityType = c.req.query('entityType');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const conditions: any[] = [];
  if (search) {
    conditions.push(ilike(signalEntities.name, `%${search}%`));
  }
  if (entityType) {
    conditions.push(eq(signalEntities.entityType, entityType as any));
  }

  const query = db
    .select()
    .from(signalEntities)
    .orderBy(desc(signalEntities.updatedAt))
    .limit(limit)
    .offset(offset);

  const results = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;

  return c.json(results);
});

// POST /signals/entities — create entity
signalRoutes.post('/entities', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{
    entityType: string;
    name: string;
    aliases?: string[];
    metadata?: Record<string, unknown>;
  }>();

  if (!body.name || !body.entityType) {
    return c.json({ error: 'name and entityType are required' }, 400);
  }

  const [entity] = await db
    .insert(signalEntities)
    .values({
      entityType: body.entityType as any,
      name: body.name,
      ...(body.aliases ? { aliases: body.aliases } : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    })
    .returning();

  return c.json(entity, 201);
});

// GET /signals/entities/:id — get entity with recent events
signalRoutes.get('/entities/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [entity] = await db
    .select()
    .from(signalEntities)
    .where(eq(signalEntities.id, id))
    .limit(1);

  if (!entity) return c.json({ error: 'Entity not found' }, 404);

  const events = await db
    .select()
    .from(signalEvents)
    .where(eq(signalEvents.entityId, id))
    .orderBy(desc(signalEvents.observedAt))
    .limit(50);

  const convergences = await db
    .select()
    .from(signalConvergences)
    .where(eq(signalConvergences.entityId, id))
    .orderBy(desc(signalConvergences.createdAt))
    .limit(5);

  return c.json({ ...entity, events, convergences });
});

// PATCH /signals/entities/:id — update entity (add aliases, etc.)
signalRoutes.patch('/entities/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    aliases?: string[];
    metadata?: Record<string, unknown>;
  }>();

  const [existing] = await db
    .select()
    .from(signalEntities)
    .where(eq(signalEntities.id, id))
    .limit(1);

  if (!existing) return c.json({ error: 'Entity not found' }, 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name) updates.name = body.name;
  if (body.aliases) updates.aliases = body.aliases;
  if (body.metadata) updates.metadata = body.metadata;

  const [updated] = await db
    .update(signalEntities)
    .set(updates)
    .where(eq(signalEntities.id, id))
    .returning();

  return c.json(updated);
});

// POST /signals/events — create signal event (auto-links to entity via fuzzy match)
signalRoutes.post('/events', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{
    entityName: string;
    entityType?: string;
    source: string;
    signalType: string;
    rawData?: Record<string, unknown>;
    confidence?: number;
    observedAt?: string;
  }>();

  if (!body.entityName || !body.source || !body.signalType) {
    return c.json({ error: 'entityName, source, and signalType are required' }, 400);
  }

  const result = await linkEventToEntity(db, body.entityName, (body.entityType || 'company') as any, {
    source: body.source,
    signalType: body.signalType,
    rawData: body.rawData || {},
    confidence: body.confidence ?? 1.0,
    observedAt: body.observedAt ? new Date(body.observedAt) : new Date(),
  });

  return c.json(result, 201);
});

// POST /signals/ingest — JSON-lines ingest endpoint (bulk create events)
signalRoutes.post('/ingest', async (c) => {
  const db = c.get('db');
  const contentType = c.req.header('content-type') || '';
  let lines: string[];

  if (contentType.includes('application/x-ndjson') || contentType.includes('text/plain')) {
    const text = await c.req.text();
    lines = text.split('\n').filter((l) => l.trim());
  } else {
    // Accept JSON array as well
    const body = await c.req.json();
    if (Array.isArray(body)) {
      lines = body.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
    } else {
      return c.json({ error: 'Expected JSON-lines (application/x-ndjson) or JSON array' }, 400);
    }
  }

  const results: Array<{ entityId: string; eventId: string; matched: boolean } | { error: string; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const record = typeof lines[i] === 'string' ? JSON.parse(lines[i]) : lines[i];
      if (!record.entityName || !record.source || !record.signalType) {
        results.push({ error: 'Missing required fields: entityName, source, signalType', line: i + 1 });
        continue;
      }
      const result = await linkEventToEntity(
        db,
        record.entityName,
        (record.entityType || 'company') as any,
        {
          source: record.source,
          signalType: record.signalType,
          rawData: record.rawData || {},
          confidence: record.confidence ?? 1.0,
          observedAt: record.observedAt ? new Date(record.observedAt) : new Date(),
        },
      );
      results.push(result);
    } catch (err: any) {
      results.push({ error: err.message || 'Parse error', line: i + 1 });
    }
  }

  return c.json({ processed: results.length, results }, 201);
});

// GET /signals/convergences — list convergences (filter by posted/unposted)
signalRoutes.get('/convergences', async (c) => {
  const db = c.get('db');
  const posted = c.req.query('posted');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const conditions: any[] = [];
  if (posted === 'true') {
    conditions.push(eq(signalConvergences.postedToSourcing, true));
  } else if (posted === 'false') {
    conditions.push(eq(signalConvergences.postedToSourcing, false));
  }

  const query = db
    .select({
      convergence: signalConvergences,
      entityName: signalEntities.name,
      entityType: signalEntities.entityType,
    })
    .from(signalConvergences)
    .innerJoin(signalEntities, eq(signalConvergences.entityId, signalEntities.id))
    .orderBy(desc(signalConvergences.convergenceScore))
    .limit(limit)
    .offset(offset);

  const results = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;

  return c.json(results);
});

// POST /signals/convergences/:id/post — mark convergence as posted to sourcing
signalRoutes.post('/convergences/:id/post', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [existing] = await db
    .select()
    .from(signalConvergences)
    .where(eq(signalConvergences.id, id))
    .limit(1);

  if (!existing) return c.json({ error: 'Convergence not found' }, 404);

  const [updated] = await db
    .update(signalConvergences)
    .set({ postedToSourcing: true })
    .where(eq(signalConvergences.id, id))
    .returning();

  return c.json(updated);
});
