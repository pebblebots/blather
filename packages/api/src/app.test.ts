import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { signToken } from './middleware/auth.js';
import { createTestDatabase, type TestDatabase } from './test/testDb.js';

describe('app', () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  beforeEach(async () => {
    await testDatabase.reset();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  it('serves /health unauthenticated with 200 (T#164)', async () => {
    const app = createApp(testDatabase.db);
    const response = await app.request('/health', { method: 'GET' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: 'blather-api' });
  });

  it('serves /api/health unauthenticated with 200 (T#164 — Caddy prefix-strip safety)', async () => {
    const app = createApp(testDatabase.db);
    const response = await app.request('/api/health', { method: 'GET' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: 'blather-api' });
  });

  it('serves the API metadata at the root with CORS enabled', async () => {
    const app = createApp(testDatabase.db);
    const response = await app.request('/', {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:8080',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: 'blather',
      version: '0.1.0',
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('uses the injected database for mounted routes', async () => {
    const app = createApp(testDatabase.db);
    const user = await testDatabase.factories.createUser();
    const response = await app.request('/auth/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${signToken(user.id)}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: user.id,
    });
  });
});
