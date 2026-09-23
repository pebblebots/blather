import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@blather/db';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

describe('authMiddleware', () => {
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

  // Use GET /channels as a representative authenticated endpoint
  const PROBE = '/channels';

  it('accepts a valid JWT in Bearer header', async () => {
    const user = await harness.factories.createUser({ email: 'jwt@example.com', displayName: 'JWT User' });
    const res = await harness.request.get(PROBE, { headers: harness.headers.forUser(user.id) });
    expect(res.status).not.toBe(401);
  });

  it('rejects an existing JWT after its user is deactivated', async () => {
    const user = await harness.factories.createUser({ email: 'inactive-jwt@example.com' });
    const headers = harness.headers.forUser(user.id);
    await harness.db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, user.id));

    const res = await harness.request.get(PROBE, { headers });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('accepts a valid API key in X-API-Key header', async () => {
    const user = await harness.factories.createUser({ email: 'apikey@example.com', displayName: 'API Key User' });
    const headers = await harness.headers.forApiKeyUser(user.id);
    const res = await harness.request.get(PROBE, { headers });
    expect(res.status).not.toBe(401);
  });

  it('rejects an existing X-API-Key after its user is deactivated', async () => {
    const user = await harness.factories.createUser({ email: 'inactive-key@example.com' });
    const headers = await harness.headers.forApiKeyUser(user.id);
    await harness.db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, user.id));

    const res = await harness.request.get(PROBE, { headers });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid API key' });
  });

  it('T#134: accepts a valid API key sent as Bearer token value', async () => {
    const user = await harness.factories.createUser({ email: 'agent@example.com', displayName: 'Agent' });
    const apiKey = await harness.tokens.apiKeyForUser(user.id, 'Agent bearer key');
    // Agent sends the API key in the Authorization: Bearer header instead of X-API-Key
    const res = await harness.request.get(PROBE, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).not.toBe(401);
  });

  it('rejects a bearer API key after its user is deactivated', async () => {
    const user = await harness.factories.createUser({ email: 'inactive-bearer-key@example.com' });
    const apiKey = await harness.tokens.apiKeyForUser(user.id);
    await harness.db.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, user.id));

    const res = await harness.request.get(PROBE, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('T#134: rejects an invalid token sent as Bearer (not a valid JWT or API key)', async () => {
    const res = await harness.request.get(PROBE, {
      headers: { Authorization: 'Bearer totally_bogus_value' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown API key sent as X-API-Key', async () => {
    const res = await harness.request.get(PROBE, { headers: { 'X-API-Key': 'blather_unknownkey0000000000000000000000000000000000000000000000000' } });
    expect(res.status).toBe(401);
  });

  it('returns 401 with no credentials', async () => {
    const res = await harness.request.get(PROBE, {});
    expect(res.status).toBe(401);
  });
});
