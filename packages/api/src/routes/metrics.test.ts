import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

const describeWithTestDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithTestDatabase('metric routes', () => {
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

  function makeMetric(overrides: Record<string, any> = {}) {
    return {
      companyName: 'Acme Corp',
      fund: 'Fund I',
      reportingDate: '2026-01-15',
      revenueArrUsd: 5000000,
      source: 'form',
      ...overrides,
    };
  }

  async function authedUser() {
    const user = await harness.factories.createUser();
    return { user, headers: harness.headers.forUser(user.id) };
  }

  // ── Create metric ──

  it('POST /metrics creates a metric with required fields', async () => {
    const { headers } = await authedUser();

    const res = await harness.request.post<any>('/metrics', {
      headers,
      json: makeMetric(),
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      companyName: 'Acme Corp',
      fund: 'Fund I',
      reportingDate: '2026-01-15',
      source: 'form',
    });
    expect(res.body.id).toBeDefined();
  });

  it('POST /metrics creates a metric with all optional fields', async () => {
    const { headers } = await authedUser();

    const res = await harness.request.post<any>('/metrics', {
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

    expect(res.status).toBe(201);
    expect(Number(res.body.headcount)).toBe(50);
    expect(Number(res.body.runwayMonths)).toBe(18);
    expect(res.body.permissionToShare).toBe(true);
  });

  it('POST /metrics returns 400 when required fields missing', async () => {
    const { headers } = await authedUser();

    const res = await harness.request.post('/metrics', {
      headers,
      json: { companyName: 'Acme Corp' },
    });

    expect(res.status).toBe(400);
  });

  it('POST /metrics returns 400 for invalid source', async () => {
    const { headers } = await authedUser();

    const res = await harness.request.post('/metrics', {
      headers,
      json: makeMetric({ source: 'manual' }),
    });

    expect(res.status).toBe(400);
  });

  // ── List metrics ──

  it('GET /metrics lists all metrics', async () => {
    const { headers } = await authedUser();

    await harness.request.post('/metrics', { headers, json: makeMetric({ companyName: 'A' }) });
    await harness.request.post('/metrics', { headers, json: makeMetric({ companyName: 'B' }) });

    const res = await harness.request.get<any[]>('/metrics', { headers });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /metrics filters by fund', async () => {
    const { headers } = await authedUser();

    await harness.request.post('/metrics', { headers, json: makeMetric({ fund: 'Fund I' }) });
    await harness.request.post('/metrics', { headers, json: makeMetric({ fund: 'Fund II', companyName: 'Other' }) });

    const res = await harness.request.get<any[]>('/metrics', {
      headers,
      query: { fund: 'Fund I' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].fund).toBe('Fund I');
  });

  it('GET /metrics filters by company_name (case-insensitive partial)', async () => {
    const { headers } = await authedUser();

    await harness.request.post('/metrics', { headers, json: makeMetric({ companyName: 'Acme Corp' }) });
    await harness.request.post('/metrics', { headers, json: makeMetric({ companyName: 'Beta Inc', fund: 'Fund II' }) });

    const res = await harness.request.get<any[]>('/metrics', {
      headers,
      query: { company_name: 'acme' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].companyName).toBe('Acme Corp');
  });

  it('GET /metrics filters by date range', async () => {
    const { headers } = await authedUser();

    await harness.request.post('/metrics', { headers, json: makeMetric({ reportingDate: '2026-01-01' }) });
    await harness.request.post('/metrics', { headers, json: makeMetric({ reportingDate: '2026-06-01', companyName: 'Later' }) });

    const res = await harness.request.get<any[]>('/metrics', {
      headers,
      query: { date_from: '2026-05-01', date_to: '2026-12-31' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].companyName).toBe('Later');
  });

  // ── Get single metric ──

  it('GET /metrics/:id returns a single metric', async () => {
    const { headers } = await authedUser();

    const createRes = await harness.request.post<any>('/metrics', {
      headers,
      json: makeMetric(),
    });

    const res = await harness.request.get<any>(`/metrics/${createRes.body.id}`, { headers });

    expect(res.status).toBe(200);
    expect(res.body.companyName).toBe('Acme Corp');
  });

  it('GET /metrics/:id returns 404 for nonexistent', async () => {
    const { headers } = await authedUser();

    const res = await harness.request.get('/metrics/00000000-0000-0000-0000-000000000000', { headers });

    expect(res.status).toBe(404);
  });

  // ── Update metric ──

  it('PATCH /metrics/:id updates fields', async () => {
    const { headers } = await authedUser();

    const createRes = await harness.request.post<any>('/metrics', {
      headers,
      json: makeMetric(),
    });

    const res = await harness.request.patch<any>(`/metrics/${createRes.body.id}`, {
      headers,
      json: { headcount: 100, runwayMonths: 24 },
    });

    expect(res.status).toBe(200);
    expect(Number(res.body.headcount)).toBe(100);
    expect(Number(res.body.runwayMonths)).toBe(24);
  });

  it('PATCH /metrics/:id rejects invalid source', async () => {
    const { headers } = await authedUser();

    const createRes = await harness.request.post<any>('/metrics', {
      headers,
      json: makeMetric(),
    });

    const res = await harness.request.patch(`/metrics/${createRes.body.id}`, {
      headers,
      json: { source: 'invalid' },
    });

    expect(res.status).toBe(400);
  });

  it('PATCH /metrics/:id returns 404 for nonexistent', async () => {
    const { headers } = await authedUser();

    const res = await harness.request.patch('/metrics/00000000-0000-0000-0000-000000000000', {
      headers,
      json: { headcount: 10 },
    });

    expect(res.status).toBe(404);
  });

  // ── Delete metric ──

  it('DELETE /metrics/:id deletes a metric', async () => {
    const { headers } = await authedUser();

    const createRes = await harness.request.post<any>('/metrics', {
      headers,
      json: makeMetric(),
    });

    const res = await harness.request.delete(`/metrics/${createRes.body.id}`, { headers });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    const getRes = await harness.request.get(`/metrics/${createRes.body.id}`, { headers });
    expect(getRes.status).toBe(404);
  });

  it('DELETE /metrics/:id returns 404 for nonexistent', async () => {
    const { headers } = await authedUser();

    const res = await harness.request.delete('/metrics/00000000-0000-0000-0000-000000000000', { headers });

    expect(res.status).toBe(404);
  });

  // ── Export endpoint ──

  it('GET /metrics/export returns data with metadata', async () => {
    const { headers } = await authedUser();

    await harness.request.post('/metrics', { headers, json: makeMetric() });

    const res = await harness.request.get<any>('/metrics/export', { headers });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.exportedAt).toBeDefined();
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /metrics/export respects filters', async () => {
    const { headers } = await authedUser();

    await harness.request.post('/metrics', { headers, json: makeMetric({ fund: 'Fund I' }) });
    await harness.request.post('/metrics', { headers, json: makeMetric({ fund: 'Fund II', companyName: 'Other' }) });

    const res = await harness.request.get<any>('/metrics/export', {
      headers,
      query: { fund: 'Fund II' },
    });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].fund).toBe('Fund II');
  });

  // ── Upsert ──

  it('PUT /metrics/upsert creates new metric when none exists', async () => {
    const { headers } = await authedUser();

    const res = await harness.request.put<any>('/metrics/upsert', {
      headers,
      json: makeMetric(),
    });

    expect(res.status).toBe(201);
    expect(res.body.companyName).toBe('Acme Corp');
  });

  it('PUT /metrics/upsert updates existing metric on same key', async () => {
    const { headers } = await authedUser();

    const first = await harness.request.put<any>('/metrics/upsert', {
      headers,
      json: makeMetric({ revenueArrUsd: 1000000 }),
    });
    expect(first.status).toBe(201);

    const second = await harness.request.put<any>('/metrics/upsert', {
      headers,
      json: makeMetric({ revenueArrUsd: 2000000 }),
    });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(Number(second.body.revenueArrUsd)).toBe(2000000);
  });

  it('PUT /metrics/upsert returns 400 for missing required fields', async () => {
    const { headers } = await authedUser();

    const res = await harness.request.put('/metrics/upsert', {
      headers,
      json: { companyName: 'Incomplete' },
    });

    expect(res.status).toBe(400);
  });
});
