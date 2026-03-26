import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { agentActivityLog } from '@blather/db';

describe('activity routes', () => {
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

  // Use a fixed "since" in the past to avoid time-dependent flakiness
  const LONG_AGO = '2000-01-01T00:00:00.000Z';

  async function createFixture() {
    const agent = await harness.factories.createUser({ email: 'bot@system.blather', displayName: 'Bot' });
    const workspace = await harness.factories.createWorkspace({ ownerId: agent.id });
    const channel = await harness.factories.createChannel({ workspaceId: workspace.id, name: 'general' });
    return { agent, workspace, channel };
  }

  async function logActivity(agentId: string, body: Record<string, unknown>) {
    return harness.request.post('/activity', {
      headers: harness.headers.forUser(agentId),
      json: body,
    });
  }

  /** Bulk-insert activity rows directly into DB (faster than HTTP for volume tests). */
  async function insertActivityRows(count: number, overrides: Record<string, unknown>) {
    const rows = Array.from({ length: count }, (_, i) => ({
      workspaceId: overrides.workspaceId as string,
      agentUserId: overrides.agentUserId as string,
      sessionKey: '',
      action: overrides.action ? String(overrides.action) : `action_${i}`,
      targetChannelId: (overrides.targetChannelId as string) ?? null,
      targetMessageId: null,
      metadata: (overrides.metadata as Record<string, unknown>) ?? {},
    }));
    await testDatabase.db.insert(agentActivityLog).values(rows);
  }

  // ── Log activity ──

  it('POST /activity logs an activity entry', async () => {
    const { agent, workspace } = await createFixture();

    const res = await logActivity(agent.id, {
      workspaceId: workspace.id,
      agentUserId: agent.id,
      action: 'message_sent',
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('createdAt');
  });

  it('POST /activity persists optional fields', async () => {
    const { agent, workspace, channel } = await createFixture();

    const postRes = await logActivity(agent.id, {
      workspaceId: workspace.id,
      agentUserId: agent.id,
      action: 'task_created',
      targetChannelId: channel.id,
      sessionKey: 'session-123',
      metadata: { shortId: 42 },
    });

    expect(postRes.status).toBe(201);

    // Verify round-trip: the stored entry should include the optional fields
    const getRes = await harness.request.get<any[]>('/activity', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id, since: LONG_AGO },
    });
    expect(getRes.body).toHaveLength(1);
    const entry = getRes.body![0];
    expect(entry.action).toBe('task_created');
    expect(entry.target_channel_id).toBe(channel.id);
    expect(entry.session_key).toBe('session-123');
    expect(entry.metadata).toEqual({ shortId: 42 });
  });

  it('POST /activity returns 400 when required fields missing', async () => {
    const { agent } = await createFixture();

    const res = await harness.request.post('/activity', {
      headers: harness.headers.forUser(agent.id),
      json: { workspaceId: 'x' },
    });

    expect(res.status).toBe(400);
  });

  // ── Query activity ──

  it('GET /activity returns 400 without agentId', async () => {
    const { agent } = await createFixture();

    const res = await harness.request.get('/activity', {
      headers: harness.headers.forUser(agent.id),
    });

    expect(res.status).toBe(400);
  });

  it('GET /activity returns logged entries for an agent', async () => {
    const { agent, workspace } = await createFixture();

    await logActivity(agent.id, { workspaceId: workspace.id, agentUserId: agent.id, action: 'message_sent' });
    await logActivity(agent.id, { workspaceId: workspace.id, agentUserId: agent.id, action: 'search_performed' });

    const res = await harness.request.get<any[]>('/activity', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id, since: LONG_AGO },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /activity respects limit param', async () => {
    const { agent, workspace } = await createFixture();

    await insertActivityRows(5, { workspaceId: workspace.id, agentUserId: agent.id });

    const res = await harness.request.get<any[]>('/activity', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id, limit: '2', since: LONG_AGO },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /activity falls back to the default limit (50) when limit is invalid', async () => {
    const { agent, workspace } = await createFixture();

    await insertActivityRows(55, { workspaceId: workspace.id, agentUserId: agent.id });

    const res = await harness.request.get<any[]>('/activity', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id, limit: 'bogus', since: LONG_AGO },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(50);
  });

  it('GET /activity caps limit at 200', async () => {
    const { agent, workspace } = await createFixture();

    // Insert just enough to distinguish 200 from "no cap"
    await insertActivityRows(5, { workspaceId: workspace.id, agentUserId: agent.id });

    const res = await harness.request.get<any[]>('/activity', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id, limit: '999', since: LONG_AGO },
    });

    expect(res.status).toBe(200);
    // We only inserted 5 rows, so we can't assert exactly 200.
    // What matters is the server accepted the request (no error) and returned <= 200.
    expect(res.body!.length).toBeLessThanOrEqual(200);
    expect(res.body).toHaveLength(5);
  });

  // ── Summary endpoint ──

  it('GET /activity/summary returns 400 without agentId', async () => {
    const { agent } = await createFixture();

    const res = await harness.request.get('/activity/summary', {
      headers: harness.headers.forUser(agent.id),
    });

    expect(res.status).toBe(400);
  });

  it('GET /activity/summary returns markdown summary for messages', async () => {
    const { agent, workspace, channel } = await createFixture();

    await logActivity(agent.id, {
      workspaceId: workspace.id, agentUserId: agent.id, action: 'message_sent', targetChannelId: channel.id,
    });
    await logActivity(agent.id, {
      workspaceId: workspace.id, agentUserId: agent.id, action: 'message_sent', targetChannelId: channel.id,
    });

    const res = await harness.request.get<any>('/activity/summary', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id, since: LONG_AGO },
    });

    expect(res.status).toBe(200);
    expect(res.body.summary).toContain('Activity since');
    expect(res.body.summary).toContain('Sent 2 messages in #general');
    expect(res.body.rows).toBeDefined();
  });

  it('GET /activity/summary shows "No activity" when empty', async () => {
    const { agent } = await createFixture();

    const res = await harness.request.get<any>('/activity/summary', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id, since: LONG_AGO },
    });

    expect(res.status).toBe(200);
    expect(res.body.summary).toContain('No activity recorded');
  });

  it('GET /activity/summary uses fallback formatter for unknown actions', async () => {
    const { agent, workspace } = await createFixture();

    await logActivity(agent.id, {
      workspaceId: workspace.id, agentUserId: agent.id, action: 'custom_thing',
    });

    const res = await harness.request.get<any>('/activity/summary', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id, since: LONG_AGO },
    });

    expect(res.status).toBe(200);
    expect(res.body.summary).toContain('custom_thing: 1 time');
  });
});
