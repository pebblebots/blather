import { Hono, type Context } from 'hono';
import { and, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import { portfolioMetrics } from '@blather/db';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';

export const metricRoutes = new Hono<Env>();
metricRoutes.use('*', authMiddleware);

const metricSources = ['form', 'agent'] as const;
type MetricSource = (typeof metricSources)[number];

type MetricBody = {
  companyName?: string;
  fund?: string;
  reportingDate?: string;
  revenueArrUsd?: number;
  revenueAsOfDate?: string | null;
  headcount?: number | null;
  runwayMonths?: number | null;
  yoyGrowthPct?: number | null;
  lastRoundSizeUsd?: number | null;
  lastRoundValuationUsd?: number | null;
  lastRoundDate?: string | null;
  lastRoundType?: string | null;
  keyMilestoneText?: string | null;
  nextFundraiseTiming?: string | null;
  contactEmail?: string | null;
  permissionToShare?: boolean;
  source?: MetricSource;
  confidence?: number | null;
};

function buildFilters(c: Context<Env>) {
  const conditions: SQL[] = [];
  const fund = c.req.query('fund');
  const companyName = c.req.query('company_name');
  const dateFrom = c.req.query('date_from');
  const dateTo = c.req.query('date_to');

  if (fund) {
    conditions.push(eq(portfolioMetrics.fund, fund));
  }

  if (companyName) {
    conditions.push(ilike(portfolioMetrics.companyName, `%${companyName}%`));
  }

  if (dateFrom) {
    conditions.push(gte(portfolioMetrics.reportingDate, dateFrom));
  }

  if (dateTo) {
    conditions.push(lte(portfolioMetrics.reportingDate, dateTo));
  }

  return conditions;
}

function isMetricSource(value: unknown): value is MetricSource {
  return typeof value === 'string' && metricSources.includes(value as MetricSource);
}

function hasRequiredFields(body: MetricBody) {
  return Boolean(
    body.companyName &&
      body.fund &&
      body.reportingDate &&
      body.revenueArrUsd !== undefined &&
      body.source,
  );
}

function metricValues(body: MetricBody) {
  return {
    companyName: body.companyName!,
    fund: body.fund!,
    reportingDate: body.reportingDate!,
    revenueArrUsd: body.revenueArrUsd!,
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
    source: body.source!,
    confidence: body.confidence ?? null,
  };
}

function invalidSourceResponse(c: Context<Env>) {
  return c.json({ error: "source must be 'form' or 'agent'" }, 400);
}

metricRoutes.get('/', async (c) => {
  const db = c.get('db');
  const conditions = buildFilters(c);

  const metrics = await db
    .select()
    .from(portfolioMetrics)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(portfolioMetrics.reportingDate));

  return c.json(metrics);
});

metricRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [metric] = await db.select().from(portfolioMetrics).where(eq(portfolioMetrics.id, id));

  if (!metric) {
    return c.json({ error: 'Metric not found' }, 404);
  }

  return c.json(metric);
});

metricRoutes.post('/', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<MetricBody>();

  if (!hasRequiredFields(body)) {
    return c.json({ error: 'companyName, fund, reportingDate, revenueArrUsd, and source are required' }, 400);
  }

  if (!isMetricSource(body.source)) {
    return invalidSourceResponse(c);
  }

  const [metric] = await db.insert(portfolioMetrics).values(metricValues(body)).returning();
  return c.json(metric, 201);
});

metricRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json<MetricBody>();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const allowedFields = [
    'companyName',
    'fund',
    'reportingDate',
    'revenueArrUsd',
    'revenueAsOfDate',
    'headcount',
    'runwayMonths',
    'yoyGrowthPct',
    'lastRoundSizeUsd',
    'lastRoundValuationUsd',
    'lastRoundDate',
    'lastRoundType',
    'keyMilestoneText',
    'nextFundraiseTiming',
    'contactEmail',
    'permissionToShare',
    'source',
    'confidence',
  ] as const;

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (updates.source !== undefined && !isMetricSource(updates.source)) {
    return invalidSourceResponse(c);
  }

  const [metric] = await db.update(portfolioMetrics).set(updates).where(eq(portfolioMetrics.id, id)).returning();

  if (!metric) {
    return c.json({ error: 'Metric not found' }, 404);
  }

  return c.json(metric);
});

metricRoutes.delete('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [metric] = await db.delete(portfolioMetrics).where(eq(portfolioMetrics.id, id)).returning();

  if (!metric) {
    return c.json({ error: 'Metric not found' }, 404);
  }

  return c.json({ ok: true });
});
