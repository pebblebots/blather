import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiKeys, magicTokens, users } from '@blather/db';
import type { AuthResponse } from '@blather/types';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

describe('auth routes', () => {
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

  // ── Magic Links ──

  it('POST /auth/magic accepts an email and stores a magic token', async () => {
    const response = await harness.request.post<{ ok: boolean; message: string }>('/auth/magic', {
      json: { email: 'Alice@Example.com' },
      headers: { origin: 'http://localhost:8080' },
    });

    expect(response.status).toBe(200);
    expect(response.body?.ok).toBe(true);

    const [storedToken] = await harness.db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.email, 'alice@example.com'))
      .limit(1);

    expect(storedToken).toBeDefined();
    expect(storedToken?.usedAt).toBeNull();
  });

  it('POST /auth/magic rejects an invalid email', async () => {
    const response = await harness.request.post('/auth/magic', {
      json: { email: 'not-an-email' },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Valid email required' });
  });

  it('POST /auth/magic/verify with valid token returns JWT and creates user', async () => {
    await harness.request.post('/auth/magic', {
      json: { email: 'verify@example.com' },
      headers: { origin: 'http://localhost:8080' },
    });

    const [storedToken] = await harness.db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.email, 'verify@example.com'))
      .limit(1);

    expect(storedToken).toBeDefined();

    const verifyResponse = await harness.request.post<AuthResponse>('/auth/magic/verify', {
      json: { token: storedToken!.token },
    });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body?.token).toBeTypeOf('string');
    expect(verifyResponse.body?.user.email).toBe('verify@example.com');

    // Token should be marked used
    const [updatedToken] = await harness.db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.id, storedToken!.id))
      .limit(1);

    expect(updatedToken?.usedAt).toBeInstanceOf(Date);
  });

  it('POST /auth/magic/verify rejects expired tokens', async () => {
    await harness.db.insert(magicTokens).values({
      email: 'expired@example.com',
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const response = await harness.request.post('/auth/magic/verify', {
      json: { token: 'expired-token' },
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid or expired token' });
  });

  it('POST /auth/magic/verify rejects already-used tokens', async () => {
    await harness.db.insert(magicTokens).values({
      email: 'used@example.com',
      token: 'used-token',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    });

    const response = await harness.request.post('/auth/magic/verify', {
      json: { token: 'used-token' },
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid or expired token' });
  });

  it('POST /auth/magic/verify rejects a nonexistent token', async () => {
    const response = await harness.request.post('/auth/magic/verify', {
      json: { token: 'does-not-exist' },
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid or expired token' });
  });

  // ── Legacy Register / Login ──

  it('POST /auth/register creates a new user', async () => {
    const response = await harness.request.post<AuthResponse>('/auth/register', {
      json: {
        email: 'register@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Registered User',
      },
    });

    expect(response.status).toBe(201);
    expect(response.body?.user.email).toBe('register@example.com');
    expect(response.body?.token).toBeTypeOf('string');
  });

  it('POST /auth/login succeeds with correct credentials', async () => {
    await harness.request.post('/auth/register', {
      json: {
        email: 'login@example.com',
        password: 'correct-horse',
        displayName: 'Login User',
      },
    });

    const response = await harness.request.post<AuthResponse>('/auth/login', {
      json: { email: 'login@example.com', password: 'correct-horse' },
    });

    expect(response.status).toBe(200);
    expect(response.body?.user.email).toBe('login@example.com');
    expect(response.body?.token).toBeTypeOf('string');
  });

  it('POST /auth/login rejects incorrect password', async () => {
    await harness.request.post('/auth/register', {
      json: {
        email: 'wrong-pw@example.com',
        password: 'correct-horse',
        displayName: 'Wrong PW',
      },
    });

    const response = await harness.request.post('/auth/login', {
      json: { email: 'wrong-pw@example.com', password: 'totally-wrong-password' },
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
  });

  // ── API Keys ──

  it('POST /auth/api-keys creates an API key for an authenticated user', async () => {
    const user = await harness.factories.createUser();

    const response = await harness.request.post<{ id: string; name: string; key: string }>('/auth/api-keys', {
      headers: harness.headers.forUser(user.id),
      json: { name: 'CLI Key' },
    });

    expect(response.status).toBe(201);
    expect(response.body?.name).toBe('CLI Key');
    expect(response.body?.key).toMatch(/^blather_/);

    const stored = await harness.db.select().from(apiKeys).where(eq(apiKeys.userId, user.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('CLI Key');
  });

  // ── Current User ──

  it('GET /auth/me returns the currently authenticated user', async () => {
    const user = await harness.factories.createUser({
      email: 'me@example.com',
      displayName: 'Me User',
    });

    const response = await harness.request.get('/auth/me', {
      headers: harness.headers.forUser(user.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: user.id,
      email: 'me@example.com',
      displayName: 'Me User',
      isAgent: false,
    });
  });

  it('GET /auth/me returns 401 without authentication', async () => {
    const response = await harness.request.get('/auth/me');

    expect(response.status).toBe(401);
  });
});
