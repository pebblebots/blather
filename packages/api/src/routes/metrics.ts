import { Hono } from 'hono';
import { eq, and, desc, gte, lte, ilike } from 'drizzle-orm';
import { portfolioMetrics } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';

export const metricRoutes = new Hono<Env>();
metricRoutes.use('*', authMiddleware);

function buildFilters(c: any) {
  const conditions: any[] = [];
  const fund = c.req.query('fund');
  if (fund) conditions.push(eq(portfolioMetrics.fund, fund));
  const companyName = c.req.query('company_name');
  if (companyName) conditions.push(ilike(portfolioMetrics.companyName, `%${companyName}%`));
  const dateFrom = c.req.query('date_from');
  if (dateFrom) conditions.push(gte(portfolioMetrics.reportingDate, dateFrom));
  const dateTo = c.req.query('date_to');
  if (dateTo) conditions.push(lte(portfolioMetrics.reportingDate, dateTo));
  return conditions;
}

// List metrics with filters
metricRoutes.get('/', async (c) => {
  const db = c.get('db');
  const conditions = buildFilters(c);

  const result = await db.select().from(portfolioMetrics)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(portfolioMetrics.reportingDate));

  return c.json(result);
});

// Export (same as list but explicit endpoint for LP consumption)
metricRoutes.get('/export', async (c) => {
  const db = c.get('db');
  const conditions = buildFilters(c);

  const result = await db.select().from(portfolioMetrics)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(portfolioMetrics.reportingDate));

  return c.json({ data: result, exportedAt: new Date().toISOString(), count: result.length });
});

// Get single metric
metricRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [metric] = await db.select().from(portfolioMetrics).where(eq(portfolioMetrics.id, id));
  if (!metric) return c.json({ error: 'Metric not found' }, 404);

  return c.json(metric);
});

// Create metric
metricRoutes.post('/', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();

  if (!body.companyName || !body.fund || !body.reportingDate || body.revenueArrUsd === undefined || !body.source) {
    return c.json({ error: 'companyName, fund, reportingDate, revenueArrUsd, and source are required' }, 400);
  }

  if (!['form', 'agent'].includes(body.source)) {
    return c.json({ error: "source must be 'form' or 'agent'" }, 400);
  }

  const [metric] = await db.insert(portfolioMetrics).values({
    companyName: body.companyName,
    fund: body.fund,
    reportingDate: body.reportingDate,
    revenueArrUsd: body.revenueArrUsd,
    revenueAsOfDate: body.revenueAsOfDate ?? null,
    headcount: body.headcount ?? null,
    runwayMonths: body.runwayMonths ?? null,
    yoyGrowthPct: body.yoyGrowthPct ?? null,
    lastRoundSizeUsd: body.lastRoundSizeUsd ?? null,
    lastRoundValuationUsd: body.lastRoundValuationUsd ?? null,
    lastRoundDate: body.lastRoundDate ?? null,
    lastRoundType: body.lastRoundType ?? null,
    keyMilestoneText: body.keyMilestoneText ?? null,
    nextFundraiseTiming: body.nextFundraiseTiming ?? null,
    contactEmail: body.contactEmail ?? null,
    permissionToShare: body.permissionToShare ?? false,
    source: body.source,
    confidence: body.confidence ?? null,
  }).returning();

  return c.json(metric, 201);
});

// Update metric
metricRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json();

  const updates: any = { updatedAt: new Date() };
  const allowedFields = [
    'companyName', 'fund', 'reportingDate', 'revenueArrUsd', 'revenueAsOfDate',
    'headcount', 'runwayMonths', 'yoyGrowthPct', 'lastRoundSizeUsd',
    'lastRoundValuationUsd', 'lastRoundDate', 'lastRoundType', 'keyMilestoneText',
    'nextFundraiseTiming', 'contactEmail', 'permissionToShare', 'source', 'confidence',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  if (updates.source && !['form', 'agent'].includes(updates.source)) {
    return c.json({ error: "source must be 'form' or 'agent'" }, 400);
  }

  const [metric] = await db.update(portfolioMetrics).set(updates).where(eq(portfolioMetrics.id, id)).returning();
  if (!metric) return c.json({ error: 'Metric not found' }, 404);

  return c.json(metric);
});

// Delete metric
metricRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [metric] = await db.delete(portfolioMetrics).where(eq(portfolioMetrics.id, id)).returning();
  if (!metric) return c.json({ error: 'Metric not found' }, 404);

  return c.json({ ok: true });
});
