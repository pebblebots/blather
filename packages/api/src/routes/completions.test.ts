import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { agentCompletions } from '@blather/db';

const INGEST_EMAIL = 'gravel-router@pebblebed.com';

describe('completion routes', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;
  let previousIngestEmails: string | undefined;

  beforeAll(async () => {
    previousIngestEmails = process.env.COMPLETIONS_INGEST_EMAILS;
    process.env.COMPLETIONS_INGEST_EMAILS = INGEST_EMAIL;
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    if (previousIngestEmails === undefined) {
      delete process.env.COMPLETIONS_INGEST_EMAILS;
    } else {
      process.env.COMPLETIONS_INGEST_EMAILS = previousIngestEmails;
    }
    await harness.close();
  });

  // Use a fixed "since" in the past to avoid time-dependent flakiness
  const LONG_AGO = '2000-01-01T00:00:00.000Z';

  async function createFixture() {
    const gateway = await harness.factories.createUser({ email: INGEST_EMAIL, displayName: 'Gravel Router' });
    const agent = await harness.factories.createUser({ email: 'bot@system.blather', displayName: 'Bot' });
    return { gateway, agent };
  }

  async function ingestCompletion(callerId: string, body: Record<string, unknown>) {
    return harness.request.post('/completions', {
      headers: harness.headers.forUser(callerId),
      json: body,
    });
  }

  async function queryCompletions(callerId: string, query: Record<string, string>) {
    return harness.request.get<any[]>('/completions', {
      headers: harness.headers.forUser(callerId),
      query: { since: LONG_AGO, ...query },
    });
  }

  // -- Ingest (gateway only) --

  it('POST /completions accepts a completion from the gateway identity', async () => {
    const { gateway, agent } = await createFixture();

    const res = await ingestCompletion(gateway.id, {
      agentUserId: agent.id,
      model: 'qwen/qwen3.8-27b',
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('createdAt');
  });

  it('POST /completions persists optional fields', async () => {
    const { gateway, agent } = await createFixture();

    const postRes = await ingestCompletion(gateway.id, {
      agentUserId: agent.id,
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
    expect(row.agent_user_id).toBe(agent.id);
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

  it('POST /completions rejects ordinary agent credentials (403)', async () => {
    const { agent } = await createFixture();

    const res = await ingestCompletion(agent.id, { agentUserId: agent.id, model: 'm' });
    expect(res.status).toBe(403);

    const rows = await queryCompletions(agent.id, { agentId: agent.id });
    expect(rows.body).toHaveLength(0);
  });

  it('POST /completions rejects regular member accounts (403)', async () => {
    const { agent } = await createFixture();
    const member = await harness.factories.createUser({ email: 'member@example.com', displayName: 'Member' });

    const res = await ingestCompletion(member.id, { agentUserId: agent.id, model: 'm' });
    expect(res.status).toBe(403);
  });

  it('POST /completions requires agentUserId and model', async () => {
    const { gateway, agent } = await createFixture();

    expect((await ingestCompletion(gateway.id, { model: 'm' })).status).toBe(400);
    expect((await ingestCompletion(gateway.id, { agentUserId: agent.id })).status).toBe(400);
    expect((await ingestCompletion(gateway.id, { agentUserId: agent.id, model: '   ' })).status).toBe(400);
  });

  it('POST /completions rejects refs that are not bounded opaque tokens', async () => {
    const { gateway, agent } = await createFixture();
    const base = { agentUserId: agent.id, model: 'm' };

    expect(
      (await ingestCompletion(gateway.id, { ...base, promptRef: 'raw prompt text with spaces' })).status,
    ).toBe(400);
    expect(
      (await ingestCompletion(gateway.id, { ...base, completionRef: 'line\nbreaks' })).status,
    ).toBe(400);
    expect(
      (await ingestCompletion(gateway.id, { ...base, promptRef: 'x'.repeat(513) })).status,
    ).toBe(400);
  });

  it('POST /completions rejects oversized metadata and whitespace session keys', async () => {
    const { gateway, agent } = await createFixture();
    const base = { agentUserId: agent.id, model: 'm' };

    expect(
      (await ingestCompletion(gateway.id, { ...base, metadata: { blob: 'x'.repeat(3000) } })).status,
    ).toBe(400);
    expect(
      (await ingestCompletion(gateway.id, { ...base, metadata: ['not', 'an', 'object'] })).status,
    ).toBe(400);
    expect(
      (await ingestCompletion(gateway.id, { ...base, sessionKey: 'has whitespace' })).status,
    ).toBe(400);
  });

  it('POST /completions rejects negative or non-integer token counts', async () => {
    const { gateway, agent } = await createFixture();
    const base = { agentUserId: agent.id, model: 'm' };

    expect((await ingestCompletion(gateway.id, { ...base, inputTokens: -1 })).status).toBe(400);
    expect((await ingestCompletion(gateway.id, { ...base, outputTokens: 1.5 })).status).toBe(400);
    expect((await ingestCompletion(gateway.id, { ...base, costUsd: -0.01 })).status).toBe(400);
  });

  // -- Query --

  it('GET /completions returns 400 without agentId', async () => {
    const { agent } = await createFixture();

    const res = await harness.request.get('/completions', {
      headers: harness.headers.forUser(agent.id),
    });

    expect(res.status).toBe(400);
  });

  it('GET /completions returns 400 for an invalid since timestamp', async () => {
    const { agent } = await createFixture();

    const res = await queryCompletions(agent.id, { agentId: agent.id, since: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('GET /completions allows an agent to read its own completions', async () => {
    const { gateway, agent } = await createFixture();
    await ingestCompletion(gateway.id, { agentUserId: agent.id, model: 'm' });

    const res = await queryCompletions(agent.id, { agentId: agent.id });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('GET /completions rejects an agent reading another agent (403)', async () => {
    const { gateway, agent } = await createFixture();
    const other = await harness.factories.createUser({ email: 'other@system.blather', displayName: 'Other', isAgent: true });
    await ingestCompletion(gateway.id, { agentUserId: other.id, model: 'm' });

    const res = await queryCompletions(agent.id, { agentId: other.id });
    expect(res.status).toBe(403);
  });

  it('GET /completions rejects a regular member reading an agent (403)', async () => {
    const { gateway, agent } = await createFixture();
    const member = await harness.factories.createUser({ email: 'member@example.com', displayName: 'Member' });
    await ingestCompletion(gateway.id, { agentUserId: agent.id, model: 'm' });

    const res = await queryCompletions(member.id, { agentId: agent.id });
    expect(res.status).toBe(403);
  });

  it('GET /completions allows an admin to read any agent', async () => {
    const { gateway, agent } = await createFixture();
    const admin = await harness.factories.createUser({ email: 'gp@example.com', displayName: 'GP', role: 'admin' });
    await ingestCompletion(gateway.id, { agentUserId: agent.id, model: 'm' });

    const res = await queryCompletions(admin.id, { agentId: agent.id });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('GET /completions filters by sessionKey', async () => {
    const { gateway, agent } = await createFixture();

    await ingestCompletion(gateway.id, { agentUserId: agent.id, model: 'm', sessionKey: 'session-a' });
    await ingestCompletion(gateway.id, { agentUserId: agent.id, model: 'm', sessionKey: 'session-b' });

    const res = await queryCompletions(agent.id, { agentId: agent.id, sessionKey: 'session-a' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].session_key).toBe('session-a');
  });

  it('GET /completions respects limit and falls back to the default (50) when invalid', async () => {
    const { agent } = await createFixture();

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
