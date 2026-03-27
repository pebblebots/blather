import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

type MetricPayload = {
  companyName: string;
  fund: string;
  reportingDate: string;
  revenueArrUsd: number;
  source: 'form' | 'agent';
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
  confidence?: number | null;
};

describe('metric routes', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.close();
  });

  function makeMetric(overrides: Partial<MetricPayload> = {}): MetricPayload {
    return {
      companyName: 'Acme Corp',
      fund: 'Fund I',
      reportingDate: '2026-01-15',
      revenueArrUsd: 5_000_000,
      source: 'form',
      ...overrides,
    };
  }

  async function authedUser() {
    const user = await harness.factories.createUser();
    return { user, headers: harness.headers.forUser(user.id) };
  }

  async function createMetricRecord(headers: HeadersInit, overrides: Partial<MetricPayload> = {}) {
    const response = await harness.request.post<any>('/metrics', {
      headers,
      json: makeMetric(overrides),
    });

    expect(response.status).toBe(201);
    return response.body;
  }

  // ── Auth ──

  it('rejects unauthenticated requests', async () => {
    const response = await harness.request.get('/metrics');
    expect(response.status).toBe(401);
  });

  // ── POST /metrics ──

  it('POST /metrics creates a metric with required fields', async () => {
    const { headers } = await authedUser();

    const response = await harness.request.post<any>('/metrics', {
      headers,
      json: makeMetric(),
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      companyName: 'Acme Corp',
      fund: 'Fund I',
      reportingDate: '2026-01-15',
      source: 'form',
    });
    expect(response.body.id).toBeDefined();
  });

  it('POST /metrics creates a metric with optional fields', async () => {
    const { headers } = await authedUser();

    const response = await harness.request.post<any>('/metrics', {
      headers,
      json: makeMetric({
        headcount: 50,
        runwayMonths: 18,
        yoyGrowthPct: 120.5,
        keyMilestoneText: 'Series A',
        contactEmail: 'ceo@acme.com',
        permissionToShare: true,
        confidence: 0.95,
      }),
    });

    expect(response.status).toBe(201);
    // headcount is an integer column — returns a number directly
    expect(response.body.headcount).toBe(50);
    // runwayMonths is a decimal column — Postgres returns strings for decimals
    expect(Number(response.body.runwayMonths)).toBe(18);
    expect(response.body.permissionToShare).toBe(true);
  });

  it('POST /metrics accepts zero revenueArrUsd', async () => {
    const { headers } = await authedUser();

    const response = await harness.request.post<any>('/metrics', {
      headers,
      json: makeMetric({ revenueArrUsd: 0 }),
    });

    expect(response.status).toBe(201);
    expect(Number(response.body.revenueArrUsd)).toBe(0);
  });

  it('POST /metrics returns 400 when required fields are missing', async () => {
    const { headers } = await authedUser();

    const response = await harness.request.post('/metrics', {
      headers,
      json: { companyName: 'Acme Corp' },
    });

    expect(response.status).toBe(400);
  });

  it('POST /metrics returns 400 for an invalid source', async () => {
    const { headers } = await authedUser();

    const response = await harness.request.post('/metrics', {
      headers,
      json: { ...makeMetric(), source: 'manual' },
    });

    expect(response.status).toBe(400);
  });

  // ── GET /metrics ──

  it('GET /metrics lists all metrics', async () => {
    const { headers } = await authedUser();

    await createMetricRecord(headers, { companyName: 'A' });
    await createMetricRecord(headers, { companyName: 'B' });

    const response = await harness.request.get<any[]>('/metrics', { headers });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
  });

  it('GET /metrics returns results ordered by reportingDate descending', async () => {
    const { headers } = await authedUser();

    await createMetricRecord(headers, { reportingDate: '2026-01-01', companyName: 'Earlier' });
    await createMetricRecord(headers, { reportingDate: '2026-06-01', companyName: 'Later' });

    const response = await harness.request.get<any[]>('/metrics', { headers });

    expect(response.status).toBe(200);
    expect(response.body![0].companyName).toBe('Later');
    expect(response.body![1].companyName).toBe('Earlier');
  });

  it('GET /metrics filters by fund', async () => {
    const { headers } = await authedUser();

    await createMetricRecord(headers, { fund: 'Fund I' });
    await createMetricRecord(headers, { fund: 'Fund II', companyName: 'Other' });

    const response = await harness.request.get<any[]>('/metrics', {
      headers,
      query: { fund: 'Fund I' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body![0].fund).toBe('Fund I');
  });

  it('GET /metrics filters by company_name with a case-insensitive partial match', async () => {
    const { headers } = await authedUser();

    await createMetricRecord(headers, { companyName: 'Acme Corp' });
    await createMetricRecord(headers, { companyName: 'Beta Inc', fund: 'Fund II' });

    const response = await harness.request.get<any[]>('/metrics', {
      headers,
      query: { company_name: 'acme' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body![0].companyName).toBe('Acme Corp');
  });

  it('GET /metrics filters by date range', async () => {
    const { headers } = await authedUser();

    await createMetricRecord(headers, { reportingDate: '2026-01-01' });
    await createMetricRecord(headers, { reportingDate: '2026-06-01', companyName: 'Later' });

    const response = await harness.request.get<any[]>('/metrics', {
      headers,
      query: { date_from: '2026-05-01', date_to: '2026-12-31' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body![0].companyName).toBe('Later');
  });

  // ── GET /metrics/:id ──

  it('GET /metrics/:id returns a single metric', async () => {
    const { headers } = await authedUser();
    const createdMetric = await createMetricRecord(headers);

    const response = await harness.request.get<any>(`/metrics/${createdMetric.id}`, { headers });

    expect(response.status).toBe(200);
    expect(response.body.companyName).toBe('Acme Corp');
  });

  it('GET /metrics/:id returns 404 for a nonexistent metric', async () => {
    const { headers } = await authedUser();

    const response = await harness.request.get('/metrics/00000000-0000-0000-0000-000000000000', { headers });

    expect(response.status).toBe(404);
  });

  // ── PATCH /metrics/:id ──

  it('PATCH /metrics/:id updates fields', async () => {
    const { headers } = await authedUser();
    const createdMetric = await createMetricRecord(headers);

    const response = await harness.request.patch<any>(`/metrics/${createdMetric.id}`, {
      headers,
      json: { headcount: 100, runwayMonths: 24 },
    });

    expect(response.status).toBe(200);
    expect(response.body.headcount).toBe(100);
    expect(Number(response.body.runwayMonths)).toBe(24);
  });

  it('PATCH /metrics/:id rejects an invalid source', async () => {
    const { headers } = await authedUser();
    const createdMetric = await createMetricRecord(headers);

    const response = await harness.request.patch(`/metrics/${createdMetric.id}`, {
      headers,
      json: { source: 'invalid' },
    });

    expect(response.status).toBe(400);
  });

  it('PATCH /metrics/:id returns 404 for a nonexistent metric', async () => {
    const { headers } = await authedUser();

    const response = await harness.request.patch('/metrics/00000000-0000-0000-0000-000000000000', {
      headers,
      json: { headcount: 10 },
    });

    expect(response.status).toBe(404);
  });

  // ── DELETE /metrics/:id ──

  it('DELETE /metrics/:id deletes a metric', async () => {
    const { headers } = await authedUser();
    const createdMetric = await createMetricRecord(headers);

    const deleteResponse = await harness.request.delete(`/metrics/${createdMetric.id}`, { headers });

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toMatchObject({ ok: true });

    const getResponse = await harness.request.get(`/metrics/${createdMetric.id}`, { headers });
    expect(getResponse.status).toBe(404);
  });

  it('DELETE /metrics/:id returns 404 for a nonexistent metric', async () => {
    const { headers } = await authedUser();

    const response = await harness.request.delete('/metrics/00000000-0000-0000-0000-000000000000', { headers });

    expect(response.status).toBe(404);
  });
});
