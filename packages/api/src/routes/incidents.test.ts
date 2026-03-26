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
    const workspace = await harness.factories.createWorkspace({ ownerId: owner.id });
    return { owner, workspace };
  }

  // ── List incidents ──

  it('GET /incidents returns 400 without workspaceId', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.get('/incidents', {
      headers: harness.headers.forUser(owner.id),
    });

    expect(res.status).toBe(400);
  });

  it('GET /incidents lists incidents for a workspace', async () => {
    const { owner, workspace } = await createFixture();

    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Incident A' },
    });
    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Incident B' },
    });

    const res = await harness.request.get<any[]>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      query: { workspaceId: workspace.id },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /incidents filters by status', async () => {
    const { owner, workspace } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'To ack' },
    });
    await harness.request.patch(`/incidents/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'acked' },
    });

    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Still open' },
    });

    const res = await harness.request.get<any[]>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      query: { workspaceId: workspace.id, status: 'acked' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].title).toBe('To ack');
  });

  it('GET /incidents filters by severity', async () => {
    const { owner, workspace } = await createFixture();

    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Critical one', severity: 'critical' },
    });
    await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Info one', severity: 'info' },
    });

    const res = await harness.request.get<any[]>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      query: { workspaceId: workspace.id, severity: 'critical' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].title).toBe('Critical one');
  });

  // ── Get single incident ──

  it('GET /incidents/:id returns a single incident', async () => {
    const { owner, workspace } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Single incident' },
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

  // ── Create incident ──

  it('POST /incidents creates an incident with defaults', async () => {
    const { owner, workspace } = await createFixture();

    const res = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'New incident' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      workspaceId: workspace.id,
      title: 'New incident',
      severity: 'warning',
      status: 'open',
      openedBy: owner.id,
    });
    expect(res.body.id).toBeDefined();
  });

  it('POST /incidents creates an incident with custom severity', async () => {
    const { owner, workspace } = await createFixture();

    const res = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Critical!', severity: 'critical' },
    });

    expect(res.status).toBe(201);
    expect(res.body.severity).toBe('critical');
  });

  it('POST /incidents returns 400 without title', async () => {
    const { owner, workspace } = await createFixture();

    const res = await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id },
    });

    expect(res.status).toBe(400);
  });

  it('POST /incidents returns 400 without workspaceId', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.post('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'No workspace' },
    });

    expect(res.status).toBe(400);
  });

  it('POST /incidents returns 403 for non-member', async () => {
    const { workspace } = await createFixture();

    const outsider = await harness.factories.createUser({ email: 'outsider@example.com', displayName: 'Outsider' });

    const res = await harness.request.post('/incidents', {
      headers: harness.headers.forUser(outsider.id),
      json: { workspaceId: workspace.id, title: 'Should fail' },
    });

    expect(res.status).toBe(403);
  });

  // ── Update incident (status transitions) ──

  it('PATCH /incidents/:id transitions open -> acked with timestamp', async () => {
    const { owner, workspace } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Ack me' },
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
    const { owner, workspace } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Resolve me' },
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
    const { owner, workspace } = await createFixture();
    const otherUser = await harness.factories.createUser({ email: 'other@example.com', displayName: 'Other' });

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Two-step' },
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
    const { owner, workspace } = await createFixture();

    const createRes = await harness.request.post<any>('/incidents', {
      headers: harness.headers.forUser(owner.id),
      json: { workspaceId: workspace.id, title: 'Escalate', severity: 'info' },
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
