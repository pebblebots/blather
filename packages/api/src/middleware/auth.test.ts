import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { apiKeys } from '@blather/db';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { hashApiKey, signToken } from './auth.js';
import { JWT_SECRET } from '../config.js';

describe('auth middleware', () => {
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

  it('valid JWT grants access', async () => {
    const user = await harness.factories.createUser();

    const response = await harness.request.get<{ id: string }>('/auth/me', {
      headers: harness.headers.forUser(user.id),
    });

    expect(response.status).toBe(200);
    expect(response.body?.id).toBe(user.id);
  });

  it('expired JWT is rejected', async () => {
    const user = await harness.factories.createUser();
    const expiredToken = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: -1 });

    const response = await harness.request.get('/auth/me', {
      headers: harness.headers.bearer(expiredToken),
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid token' });
  });

  it('malformed JWT is rejected', async () => {
    const response = await harness.request.get('/auth/me', {
      headers: harness.headers.bearer('this-is-not-a-jwt'),
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid token' });
  });

  it('valid API key grants access', async () => {
    const user = await harness.factories.createUser();
    const rawKey = await harness.tokens.apiKeyForUser(user.id);

    const response = await harness.request.get<{ id: string }>('/auth/me', {
      headers: harness.headers.apiKey(rawKey),
    });

    expect(response.status).toBe(200);
    expect(response.body?.id).toBe(user.id);

    const [updatedKey] = await harness.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hashApiKey(rawKey)))
      .limit(1);

    expect(updatedKey?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('revoked API key is rejected', async () => {
    const user = await harness.factories.createUser();
    const rawKey = await harness.tokens.apiKeyForUser(user.id);

    await harness.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.keyHash, hashApiKey(rawKey)));

    const response = await harness.request.get('/auth/me', {
      headers: harness.headers.apiKey(rawKey),
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid API key' });
  });

  it('missing auth header returns 401', async () => {
    const response = await harness.request.get('/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Authentication required' });
  });
});

describe('auth helpers', () => {
  it('signToken() produces a valid JWT', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const token = signToken(userId);
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };

    expect(payload.sub).toBe(userId);
  });

  it('hashApiKey() is deterministic', () => {
    const apiKey = 'blather_test_key';

    expect(hashApiKey(apiKey)).toBe(hashApiKey(apiKey));
    expect(hashApiKey(apiKey)).not.toBe(hashApiKey('blather_test_key_other'));
  });
});
