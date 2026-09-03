import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { agentCompletions } from '@blather/db';

describe('completion routes', () => {
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

  async function createAgent() {
    return harness.factories.createUser({ email: 'bot@system.blather', displayName: 'Bot' });
  }

  async function logCompletion(agentId: string, body: Record<string, unknown>) {
    return harness.request.post('/completions', {
      headers: harness.headers.forUser(agentId),
      json: body,
    });
  }

  async function queryCompletions(agentId: string, query: Record<string, string>) {
    return harness.request.get<any[]>('/completions', {
      headers: harness.headers.forUser(agentId),
      query: { since: LONG_AGO, ...query },
    });
  }

  // -- Log completions --

  it('POST /completions records a completion', async () => {
    const agent = await createAgent();

    const res = await logCompletion(agent.id, { model: 'qwen/qwen3.8-27b' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('createdAt');
  });

  it('POST /completions persists optional fields', async () => {
    const agent = await createAgent();

    const postRes = await logCompletion(agent.id, {
      model: 'deepseek/deepseek-v4-flash-0731',
      sessionKey: 'session-abc',
      promptRef: 'completions/prompts/deadbeef',
      completionRef: 'completions/outputs/deadbeef',
      inputTokens: 1200,
      outputTokens: 340,
      latencyMs: 2150,
      costUsd: 0.000036,
      metadata: { workload: 'inbound-triage' },
    });
    expect(postRes.status).toBe(201);

    const getRes = await queryCompletions(agent.id, { agentId: agent.id });
    expect(getRes.body).toHaveLength(1);
    const row = getRes.body![0];
    expect(row.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(row.session_key).toBe('session-abc');
    expect(row.prompt_ref).toBe('completions/prompts/deadbeef');
    expect(row.completion_ref).toBe('completions/outputs/deadbeef');
    expect(row.input_tokens).toBe(1200);
    expect(row.output_tokens).toBe(340);
    expect(row.latency_ms).toBe(2150);
    expect(Number(row.cost_usd)).toBeCloseTo(0.000036);
    expect(row.metadata).toEqual({ workload: 'inbound-triage' });
  });

  it('POST /completions returns 400 when model is missing or blank', async () => {
    const agent = await createAgent();

    expect((await logCompletion(agent.id, {})).status).toBe(400);
    expect((await logCompletion(agent.id, { model: '   ' })).status).toBe(400);
  });

  it('POST /completions rejects negative or non-integer token counts', async () => {
    const agent = await createAgent();

    expect((await logCompletion(agent.id, { model: 'm', inputTokens: -1 })).status).toBe(400);
    expect((await logCompletion(agent.id, { model: 'm', outputTokens: 1.5 })).status).toBe(400);
    expect((await logCompletion(agent.id, { model: 'm', costUsd: -0.01 })).status).toBe(400);
  });

  it('POST /completions rejects logging for another user (spoofing)', async () => {
    const agent = await createAgent();
    const victim = await harness.factories.createUser({ email: 'victim@system.blather', displayName: 'Victim', isAgent: true });

    const res = await logCompletion(agent.id, { agentUserId: victim.id, model: 'm' });
    expect(res.status).toBe(403);

    // Nothing was logged under the victim's id (checked as the victim,
    // since agents cannot read each other's completions).
    const victimRows = await queryCompletions(victim.id, { agentId: victim.id });
    expect(victimRows.body).toHaveLength(0);
  });

  it('POST /completions attributes the row to the authenticated caller', async () => {
    const agent = await createAgent();

    const res = await logCompletion(agent.id, { model: 'm' });
    expect(res.status).toBe(201);

    const mine = await queryCompletions(agent.id, { agentId: agent.id });
    expect(mine.body).toHaveLength(1);
    expect(mine.body![0].agent_user_id).toBe(agent.id);
  });

  // -- Query completions --

  it('GET /completions rejects an agent reading another agent (403)', async () => {
    const agent = await createAgent();
    const other = await harness.factories.createUser({ email: 'other@system.blather', displayName: 'Other', isAgent: true });
    await logCompletion(other.id, { model: 'm' });

    const res = await queryCompletions(agent.id, { agentId: other.id });
    expect(res.status).toBe(403);
  });

  it('GET /completions allows a human to read any agent', async () => {
    const agent = await createAgent();
    const human = await harness.factories.createUser({ email: 'kma@example.com', displayName: 'Human' });
    await logCompletion(agent.id, { model: 'm' });

    const res = await queryCompletions(human.id, { agentId: agent.id });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('GET /completions returns 400 for an invalid since timestamp', async () => {
    const agent = await createAgent();

    const res = await queryCompletions(agent.id, { agentId: agent.id, since: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('GET /completions returns 400 without agentId', async () => {
    const agent = await createAgent();

    const res = await harness.request.get('/completions', {
      headers: harness.headers.forUser(agent.id),
    });

    expect(res.status).toBe(400);
  });

  it('GET /completions filters by sessionKey', async () => {
    const agent = await createAgent();

    await logCompletion(agent.id, { model: 'm', sessionKey: 'session-a' });
    await logCompletion(agent.id, { model: 'm', sessionKey: 'session-b' });

    const res = await queryCompletions(agent.id, { agentId: agent.id, sessionKey: 'session-a' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].session_key).toBe('session-a');
  });

  it('GET /completions respects limit and falls back to the default (50) when invalid', async () => {
    const agent = await createAgent();

    const rows = Array.from({ length: 55 }, () => ({
      agentUserId: agent.id,
      sessionKey: '',
      model: 'm',
    }));
    await testDatabase.db.insert(agentCompletions).values(rows);

    const limited = await queryCompletions(agent.id, { agentId: agent.id, limit: '2' });
    expect(limited.body).toHaveLength(2);

    const fallback = await queryCompletions(agent.id, { agentId: agent.id, limit: 'bogus' });
    expect(fallback.body).toHaveLength(50);
  });
});
