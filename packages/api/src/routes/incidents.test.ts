import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

describe('incident routes', () => {
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

  async function createFixture() {
    const owner = await harness.factories.createUser({ email: 'owner@example.com', displayName: 'Owner' });
    return { owner };
  }

  // -- List incidents --

  it('GET /incidents lists incidents', async () => {
    const { owner } = await createFixture();

    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Incident A' },
    });
    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Incident B' },
    });

    const res = await harness.request.get<any[]>('/incidents', {
      headers: harness.headers.forUser(owner.id),
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /incidents filters by status', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'To ack' },
    });
    await harness.request.patch(`/incidents/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'acked' },
    });

    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Still open' },
    });

    const res = await harness.request.get<any[]>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      query: { status: 'acked' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].title).toBe('To ack');
  });

  it('GET /incidents filters by severity', async () => {
    const { owner } = await createFixture();

    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Critical one', severity: 'critical' },
    });
    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Info one', severity: 'info' },
    });

    const res = await harness.request.get<any[]>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      query: { severity: 'critical' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].title).toBe('Critical one');
  });

  // -- Get single incident --

  it('GET /incidents/:id returns a single incident', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Single incident' },
    });

    const res = await harness.request.get<any>(`/incidents/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Single incident');
    expect(res.body.id).toBe(createRes.body.id);
  });

  it('GET /incidents/:id returns 404 for nonexistent incident', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.get('/incidents/00000000-0000-0000-0000-000000000000', {
      headers: harness.headers.forUser(owner.id),
    });

    expect(res.status).toBe(404);
  });

  // -- Create incident --

  it('POST /incidents creates an incident with defaults', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'New incident' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'New incident',
      severity: 'warning',
      status: 'open',
      openedBy: owner.id,
    });
    expect(res.body.id).toBeDefined();
  });

  it('POST /incidents creates an incident with custom severity', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Critical!', severity: 'critical' },
    });

    expect(res.status).toBe(201);
    expect(res.body.severity).toBe('critical');
  });

  it('POST /incidents returns 400 without title', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: {},
    });

    expect(res.status).toBe(400);
  });

  // -- Update incident (status transitions) --

  it('PATCH /incidents/:id transitions open -> acked with timestamp', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Ack me' },
    });
    expect(createRes.body.status).toBe('open');
    expect(createRes.body.ackedAt).toBeNull();

    const res = await harness.request.patch<any>(`/incidents/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'acked' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acked');
    expect(res.body.ackedBy).toBe(owner.id);
    expect(res.body.ackedAt).not.toBeNull();
  });

  it('PATCH /incidents/:id transitions open -> resolved with timestamp and resolution', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Resolve me' },
    });

    const res = await harness.request.patch<any>(`/incidents/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'resolved', resolution: 'Fixed the root cause' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(res.body.resolvedBy).toBe(owner.id);
    expect(res.body.resolvedAt).not.toBeNull();
    expect(res.body.resolution).toBe('Fixed the root cause');
  });

  it('PATCH /incidents/:id transitions acked -> resolved by another member', async () => {
    const { owner } = await createFixture();
    const otherUser = await harness.factories.createUser({ email: 'other@example.com', displayName: 'Other' });

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Two-step' },
    });

    // First ack
    await harness.request.patch(`/incidents/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'acked' },
    });

    // Then resolve (by a different user)
    const res = await harness.request.patch<any>(`/incidents/${createRes.body.id}`, {
      headers: harness.headers.forUser(otherUser.id),
      json: { status: 'resolved', resolution: 'All clear' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(res.body.ackedBy).toBe(owner.id);
    expect(res.body.resolvedBy).toBe(otherUser.id);
    expect(res.body.resolution).toBe('All clear');
  });

  it('PATCH /incidents/:id updates severity', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Escalate', severity: 'info' },
    });
    expect(createRes.body.severity).toBe('info');

    const res = await harness.request.patch<any>(`/incidents/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { severity: 'critical' },
    });

    expect(res.status).toBe(200);
    expect(res.body.severity).toBe('critical');
  });

  it('PATCH /incidents/:id returns 404 for nonexistent incident', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.patch('/incidents/00000000-0000-0000-0000-000000000000', {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'acked' },
    });

    expect(res.status).toBe(404);
  });
});
