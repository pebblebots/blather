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
    revenueArrUsd: String(body.revenueArrUsd!),
    revenueAsOfDate: body.revenueAsOfDate ?? null,
    headcount: body.headcount ?? null,
    runwayMonths: body.runwayMonths != null ? String(body.runwayMonths) : null,
    yoyGrowthPct: body.yoyGrowthPct != null ? String(body.yoyGrowthPct) : null,
    lastRoundSizeUsd: body.lastRoundSizeUsd != null ? String(body.lastRoundSizeUsd) : null,
    lastRoundValuationUsd: body.lastRoundValuationUsd != null ? String(body.lastRoundValuationUsd) : null,
    lastRoundDate: body.lastRoundDate ?? null,
    lastRoundType: body.lastRoundType ?? null,
    keyMilestoneText: body.keyMilestoneText ?? null,
    nextFundraiseTiming: body.nextFundraiseTiming ?? null,
    contactEmail: body.contactEmail ?? null,
    permissionToShare: body.permissionToShare ?? false,
    source: body.source!,
    confidence: body.confidence != null ? String(body.confidence) : null,
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

metricRoutes.post('/upsert', async (c) => {
  const db = c.get('db');
  const body = await c.req.json<MetricBody>();

  if (!hasRequiredFields(body)) {
    return c.json({ error: 'companyName, fund, reportingDate, revenueArrUsd, and source are required' }, 400);
  }

  if (!isMetricSource(body.source)) {
    return invalidSourceResponse(c);
  }

  const values = metricValues(body);

  const [metric] = await db
    .insert(portfolioMetrics)
    .values(values)
    .onConflictDoUpdate({
      target: [portfolioMetrics.companyName, portfolioMetrics.fund, portfolioMetrics.reportingDate],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  const wasInserted = metric.createdAt.getTime() === metric.updatedAt.getTime();

  return c.json({ ...metric, wasInserted }, wasInserted ? 201 : 200);
});

metricRoutes.get('/export', async (c) => {
  const db = c.get('db');
  const conditions = buildFilters(c);
  const includeAll = c.req.query('includeAll') === 'true';
  const format = c.req.query('format') ?? 'json';

  if (!['json', 'markdown', 'csv'].includes(format)) {
    return c.json({ error: "format must be 'json', 'markdown', or 'csv'" }, 400);
  }

  if (!includeAll) {
    conditions.push(eq(portfolioMetrics.permissionToShare, true));
  }

  const rows = await db
    .select()
    .from(portfolioMetrics)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(portfolioMetrics.reportingDate));

  const arrValues = rows
    .map((r) => parseFloat(r.revenueArrUsd))
    .filter((v) => !isNaN(v))
    .sort((a, b) => a - b);

  const headcountValues = rows
    .map((r) => r.headcount)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  const growthValues = rows
    .map((r) => (r.yoyGrowthPct != null ? parseFloat(r.yoyGrowthPct) : NaN))
    .filter((v) => !isNaN(v));

  const median = (sorted: number[]) =>
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const summary = {
    totalCompanies: rows.length,
    medianArr: median(arrValues),
    medianHeadcount: median(headcountValues),
    aggregateYoyGrowthPct:
      growthValues.length > 0
        ? growthValues.reduce((a, b) => a + b, 0) / growthValues.length
        : null,
  };

  if (format === 'csv') {
    const headers = [
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
    ];

    const escCsv = (v: unknown) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const csvRows = [
      headers.join(','),
      ...rows.map((r) =>
        headers.map((h) => escCsv(r[h as keyof typeof r])).join(','),
      ),
    ];

    return c.text(csvRows.join('\n'), 200, { 'Content-Type': 'text/csv' });
  }

  if (format === 'markdown') {
    const lines: string[] = [];
    lines.push('# Portfolio Summary');
    lines.push('');
    lines.push(`- **Total companies:** ${summary.totalCompanies}`);
    lines.push(`- **Median ARR:** ${summary.medianArr != null ? `$${summary.medianArr.toLocaleString('en-US')}` : 'N/A'}`);
    lines.push(`- **Median headcount:** ${summary.medianHeadcount ?? 'N/A'}`);
    lines.push(`- **Aggregate YoY growth:** ${summary.aggregateYoyGrowthPct != null ? `${summary.aggregateYoyGrowthPct.toFixed(1)}%` : 'N/A'}`);
    lines.push('');

    for (const r of rows) {
      lines.push(`## ${r.companyName}`);
      lines.push('');
      lines.push(`- **ARR:** $${parseFloat(r.revenueArrUsd).toLocaleString('en-US')}`);
      if (r.headcount != null) lines.push(`- **Headcount:** ${r.headcount}`);
      if (r.runwayMonths != null) lines.push(`- **Runway:** ${r.runwayMonths} months`);
      if (r.yoyGrowthPct != null) lines.push(`- **YoY growth:** ${r.yoyGrowthPct}%`);
      if (r.keyMilestoneText) lines.push(`- **Key milestone:** ${r.keyMilestoneText}`);
      if (r.lastRoundType || r.lastRoundSizeUsd || r.lastRoundDate) {
        const parts: string[] = [];
        if (r.lastRoundType) parts.push(r.lastRoundType);
        if (r.lastRoundSizeUsd) parts.push(`$${parseFloat(r.lastRoundSizeUsd).toLocaleString('en-US')}`);
        if (r.lastRoundDate) parts.push(r.lastRoundDate);
        lines.push(`- **Last round:** ${parts.join(' / ')}`);
      }
      lines.push('');
    }

    return c.text(lines.join('\n'), 200, { 'Content-Type': 'text/markdown' });
  }

  return c.json({ summary, companies: rows });
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
