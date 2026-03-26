import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

// Mock side-effectful modules
vi.mock('../huddle/orchestrator.js', () => ({
  startOrchestrator: vi.fn(async () => {}),
  endHuddle: vi.fn(async () => {}),
}));

vi.mock('../huddle/tts.js', () => ({
  generateTTS: vi.fn(async () => ({ audioUrl: '/audio/test.mp3', duration: 1.5 })),
}));

vi.mock('../ws/manager.js', () => ({
  publishEvent: vi.fn(async () => {}),
}));

vi.mock('../ws/events.js', () => ({
  emitEvent: vi.fn(async () => {}),
}));

describe('huddle routes', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function createFixture() {
    const human = await harness.factories.createUser({ email: 'human@example.com', displayName: 'Human', isAgent: false });
    const agent1 = await harness.factories.createUser({ email: 'agent1@system.blather', displayName: 'Agent1', isAgent: true });
    const agent2 = await harness.factories.createUser({ email: 'agent2@system.blather', displayName: 'Agent2', isAgent: true });
    const workspace = await harness.factories.createWorkspace({ ownerId: human.id });
    return { human, agent1, agent2, workspace };
  }

  // ── Create huddle ──

  it('POST /huddles creates a huddle', async () => {
    const { human, agent1, workspace } = await createFixture();

    const res = await harness.request.post<any>('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: {
        workspaceId: workspace.id,
        topic: 'Sprint planning',
        agentIds: [agent1.id],
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.topic).toBe('Sprint planning');
    expect(res.body.status).toBe('active');
    expect(res.body.channel).toBeDefined();
    expect(res.body.participants).toHaveLength(2); // human + agent1
  });

  it('POST /huddles returns 400 without required fields', async () => {
    const { human } = await createFixture();

    const res = await harness.request.post('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: { workspaceId: 'x' },
    });

    expect(res.status).toBe(400);
  });

  it('POST /huddles returns 400 when agentIds exceeds 3', async () => {
    const { human, workspace } = await createFixture();

    const extraAgents = await Promise.all([
      harness.factories.createUser({ email: 'a3@system.blather', displayName: 'A3', isAgent: true }),
      harness.factories.createUser({ email: 'a4@system.blather', displayName: 'A4', isAgent: true }),
      harness.factories.createUser({ email: 'a5@system.blather', displayName: 'A5', isAgent: true }),
      harness.factories.createUser({ email: 'a6@system.blather', displayName: 'A6', isAgent: true }),
    ]);

    const res = await harness.request.post('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: {
        workspaceId: workspace.id,
        topic: 'Too many agents',
        agentIds: extraAgents.map(a => a.id),
      },
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Maximum 3 agents per huddle' });
  });

  it('POST /huddles returns 403 when creator is an agent', async () => {
    const { agent1, agent2, workspace } = await createFixture();

    const res = await harness.request.post('/huddles', {
      headers: harness.headers.forUser(agent1.id),
      json: {
        workspaceId: workspace.id,
        topic: 'Agent tries to create',
        agentIds: [agent2.id],
      },
    });

    expect(res.status).toBe(403);
  });

  it('POST /huddles returns 400 when agentId is not an agent', async () => {
    const { human, workspace } = await createFixture();
    const nonAgent = await harness.factories.createUser({ email: 'notbot@example.com', displayName: 'NotBot', isAgent: false });

    const res = await harness.request.post('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: {
        workspaceId: workspace.id,
        topic: 'Bad agent',
        agentIds: [nonAgent.id],
      },
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('is not an agent') });
  });

  // ── List huddles ──

  it('GET /huddles returns 400 without workspaceId', async () => {
    const { human } = await createFixture();

    const res = await harness.request.get('/huddles', {
      headers: harness.headers.forUser(human.id),
    });

    expect(res.status).toBe(400);
  });

  it('GET /huddles lists active huddles for a workspace', async () => {
    const { human, agent1, workspace } = await createFixture();

    await harness.request.post('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: { workspaceId: workspace.id, topic: 'Huddle 1', agentIds: [agent1.id] },
    });

    const res = await harness.request.get<any[]>('/huddles', {
      headers: harness.headers.forUser(human.id),
      query: { workspaceId: workspace.id },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].topic).toBe('Huddle 1');
  });

  // ── Get single huddle ──

  it('GET /huddles/:id returns huddle with participants and channel', async () => {
    const { human, agent1, workspace } = await createFixture();

    const createRes = await harness.request.post<any>('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: { workspaceId: workspace.id, topic: 'Detail test', agentIds: [agent1.id] },
    });

    const res = await harness.request.get<any>(`/huddles/${createRes.body.id}`, {
      headers: harness.headers.forUser(human.id),
    });

    expect(res.status).toBe(200);
    expect(res.body.topic).toBe('Detail test');
    expect(res.body.participants).toHaveLength(2);
    expect(res.body.channel).toBeDefined();
  });

  it('GET /huddles/:id returns 404 for nonexistent', async () => {
    const { human } = await createFixture();

    const res = await harness.request.get('/huddles/00000000-0000-0000-0000-000000000000', {
      headers: harness.headers.forUser(human.id),
    });

    expect(res.status).toBe(404);
  });

  // ── Join huddle ──

  it('POST /huddles/:id/join adds a new listener', async () => {
    const { human, agent1, workspace } = await createFixture();
    const joiner = await harness.factories.createUser({ email: 'joiner@example.com', displayName: 'Joiner', isAgent: false });

    const createRes = await harness.request.post<any>('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: { workspaceId: workspace.id, topic: 'Join test', agentIds: [agent1.id] },
    });

    const res = await harness.request.post(`/huddles/${createRes.body.id}/join`, {
      headers: harness.headers.forUser(joiner.id),
    });

    expect(res.status).toBe(200);

    // Verify participant now shows up in huddle detail
    const detailRes = await harness.request.get<any>(`/huddles/${createRes.body.id}`, {
      headers: harness.headers.forUser(human.id),
    });
    expect(detailRes.body.participants).toHaveLength(3);
  });

  it('POST /huddles/:id/join returns 404 for nonexistent huddle', async () => {
    const { human } = await createFixture();

    const res = await harness.request.post('/huddles/00000000-0000-0000-0000-000000000000/join', {
      headers: harness.headers.forUser(human.id),
    });

    expect(res.status).toBe(404);
  });

  it('POST /huddles/:id/join returns 409 when already a participant', async () => {
    const { human, agent1, workspace } = await createFixture();

    const createRes = await harness.request.post<any>('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: { workspaceId: workspace.id, topic: 'Dup join', agentIds: [agent1.id] },
    });

    // Creator is already a participant
    const res = await harness.request.post(`/huddles/${createRes.body.id}/join`, {
      headers: harness.headers.forUser(human.id),
    });

    expect(res.status).toBe(409);
  });

  // ── Speak in huddle ──

  it('POST /huddles/:id/speak posts a message and returns messageId', async () => {
    const { human, agent1, workspace } = await createFixture();

    const createRes = await harness.request.post<any>('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: { workspaceId: workspace.id, topic: 'Speak test', agentIds: [agent1.id] },
    });

    const res = await harness.request.post<any>(`/huddles/${createRes.body.id}/speak`, {
      headers: harness.headers.forUser(human.id),
      json: { content: 'Hello huddle!' },
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.messageId).toBeDefined();
  });

  it('POST /huddles/:id/speak returns 404 for nonexistent huddle', async () => {
    const { human } = await createFixture();

    const res = await harness.request.post('/huddles/00000000-0000-0000-0000-000000000000/speak', {
      headers: harness.headers.forUser(human.id),
      json: { content: 'Nobody home' },
    });

    expect(res.status).toBe(404);
  });

  // ── End huddle ──

  it('DELETE /huddles/:id ends an active huddle', async () => {
    const { human, agent1, workspace } = await createFixture();

    const createRes = await harness.request.post<any>('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: { workspaceId: workspace.id, topic: 'End test', agentIds: [agent1.id] },
    });

    const res = await harness.request.delete(`/huddles/${createRes.body.id}`, {
      headers: harness.headers.forUser(human.id),
    });

    expect(res.status).toBe(200);
  });

  it('DELETE /huddles/:id returns 404 for nonexistent huddle', async () => {
    const { human } = await createFixture();

    const res = await harness.request.delete('/huddles/00000000-0000-0000-0000-000000000000', {
      headers: harness.headers.forUser(human.id),
    });

    expect(res.status).toBe(404);
  });

  it('DELETE /huddles/:id returns 403 when non-creator tries to end', async () => {
    const { human, agent1, workspace } = await createFixture();
    const other = await harness.factories.createUser({ email: 'other@example.com', displayName: 'Other', isAgent: false });

    const createRes = await harness.request.post<any>('/huddles', {
      headers: harness.headers.forUser(human.id),
      json: { workspaceId: workspace.id, topic: 'Auth test', agentIds: [agent1.id] },
    });

    const res = await harness.request.delete(`/huddles/${createRes.body.id}`, {
      headers: harness.headers.forUser(other.id),
    });

    expect(res.status).toBe(403);
  });
});
