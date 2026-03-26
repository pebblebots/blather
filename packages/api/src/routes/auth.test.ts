import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiKeys, magicTokens, users } from '@blather/db';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

type MagicResponse = {
  ok: boolean;
  message: string;
};

type VerifyMagicResponse = {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    isAgent: boolean;
    createdAt: string;
  };
};

type AuthResponse = {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    isAgent: boolean;
    createdAt: string;
  };
};

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

  it('POST /auth/magic accepts an email and stores a magic token', async () => {
    const response = await harness.request.post<MagicResponse>('/auth/magic', {
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

  it('POST /auth/magic/verify with valid token returns JWT and marks token used', async () => {
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

    const verifyResponse = await harness.request.post<VerifyMagicResponse>('/auth/magic/verify', {
      json: { token: storedToken!.token },
    });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body?.token).toBeTypeOf('string');
    expect(verifyResponse.body?.user.email).toBe('verify@example.com');

    const [updatedToken] = await harness.db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.id, storedToken!.id))
      .limit(1);

    expect(updatedToken?.usedAt).toBeInstanceOf(Date);
  });

  it('POST /auth/magic/verify rejects expired or used tokens', async () => {
    await harness.db.insert(magicTokens).values({
      email: 'expired@example.com',
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 60_000),
    });

    await harness.db.insert(magicTokens).values({
      email: 'used@example.com',
      token: 'used-token',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    });

    const expiredResponse = await harness.request.post('/auth/magic/verify', {
      json: { token: 'expired-token' },
    });

    const usedResponse = await harness.request.post('/auth/magic/verify', {
      json: { token: 'used-token' },
    });

    expect(expiredResponse.status).toBe(401);
    expect(expiredResponse.body).toEqual({ error: 'Invalid or expired token' });

    expect(usedResponse.status).toBe(401);
    expect(usedResponse.body).toEqual({ error: 'Invalid or expired token' });
  });

  it('POST /auth/register creates a user and POST /auth/login accepts correct password and rejects incorrect password', async () => {
    const registerResponse = await harness.request.post<AuthResponse>('/auth/register', {
      json: {
        email: 'register@example.com',
        password: 'correct-horse-battery-staple',
        displayName: 'Registered User',
      },
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body?.user.email).toBe('register@example.com');
    expect(registerResponse.body?.token).toBeTypeOf('string');

    const [registeredUser] = await harness.db
      .select()
      .from(users)
      .where(eq(users.email, 'register@example.com'))
      .limit(1);

    expect(registeredUser).toBeDefined();
    expect(registeredUser?.passwordHash).toBeTypeOf('string');

    const loginSuccess = await harness.request.post<AuthResponse>('/auth/login', {
      json: {
        email: 'register@example.com',
        password: 'correct-horse-battery-staple',
      },
    });

    expect(loginSuccess.status).toBe(200);
    expect(loginSuccess.body?.user.id).toBe(registeredUser?.id);

    const loginFailure = await harness.request.post('/auth/login', {
      json: {
        email: 'register@example.com',
        password: 'totally-wrong-password',
      },
    });

    expect(loginFailure.status).toBe(401);
    expect(loginFailure.body).toEqual({ error: 'Invalid credentials' });
  });

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
});
