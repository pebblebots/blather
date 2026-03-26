import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

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

  async function createFixture() {
    const agent = await harness.factories.createUser({ email: 'bot@system.blather', displayName: 'Bot' });
    const workspace = await harness.factories.createWorkspace({ ownerId: agent.id });
    const channel = await harness.factories.createChannel({ workspaceId: workspace.id, name: 'general' });
    return { agent, workspace, channel };
  }

  // ── Log activity ──

  it('POST /activity logs an activity entry', async () => {
    const { agent, workspace } = await createFixture();

    const res = await harness.request.post<any>('/activity', {
      headers: harness.headers.forUser(agent.id),
      json: {
        workspaceId: workspace.id,
        agentUserId: agent.id,
        action: 'message_sent',
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
  });

  it('POST /activity logs with optional fields', async () => {
    const { agent, workspace, channel } = await createFixture();

    const res = await harness.request.post<any>('/activity', {
      headers: harness.headers.forUser(agent.id),
      json: {
        workspaceId: workspace.id,
        agentUserId: agent.id,
        action: 'task_created',
        targetChannelId: channel.id,
        sessionKey: 'session-123',
        metadata: { shortId: 42 },
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
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

    await harness.request.post('/activity', {
      headers: harness.headers.forUser(agent.id),
      json: { workspaceId: workspace.id, agentUserId: agent.id, action: 'message_sent' },
    });
    await harness.request.post('/activity', {
      headers: harness.headers.forUser(agent.id),
      json: { workspaceId: workspace.id, agentUserId: agent.id, action: 'search_performed' },
    });

    const res = await harness.request.get<any[]>('/activity', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /activity respects limit param', async () => {
    const { agent, workspace } = await createFixture();

    for (let i = 0; i < 5; i++) {
      await harness.request.post('/activity', {
        headers: harness.headers.forUser(agent.id),
        json: { workspaceId: workspace.id, agentUserId: agent.id, action: `action_${i}` },
      });
    }

    const res = await harness.request.get<any[]>('/activity', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id, limit: '2' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  // ── Summary endpoint ──

  it('GET /activity/summary returns 400 without agentId', async () => {
    const { agent } = await createFixture();

    const res = await harness.request.get('/activity/summary', {
      headers: harness.headers.forUser(agent.id),
    });

    expect(res.status).toBe(400);
  });

  it('GET /activity/summary returns markdown summary', async () => {
    const { agent, workspace, channel } = await createFixture();

    await harness.request.post('/activity', {
      headers: harness.headers.forUser(agent.id),
      json: { workspaceId: workspace.id, agentUserId: agent.id, action: 'message_sent', targetChannelId: channel.id },
    });
    await harness.request.post('/activity', {
      headers: harness.headers.forUser(agent.id),
      json: { workspaceId: workspace.id, agentUserId: agent.id, action: 'message_sent', targetChannelId: channel.id },
    });

    const res = await harness.request.get<any>('/activity/summary', {
      headers: harness.headers.forUser(agent.id),
      query: { agentId: agent.id },
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
      query: { agentId: agent.id },
    });

    expect(res.status).toBe(200);
    expect(res.body.summary).toContain('No activity recorded');
  });
});
