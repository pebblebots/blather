import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from './apiHarness.js';
import { createTestDatabase, type TestDatabase } from './testDb.js';

describe('api test harness', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);

    harness.app.get('/_test-harness/query', (context) => {
      return context.json(context.req.query());
    });

    harness.app.post('/_test-harness/json', async (context) => {
      return context.json({
        contentType: context.req.header('content-type'),
        body: await context.req.json(),
      });
    });

    harness.app.get('/_test-harness/text', (context) => {
      return context.text('plain text response');
    });
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('can call authenticated routes using JWT helper headers', async () => {
    const user = await harness.factories.createUser();
    const response = await harness.request.get<{ id: string }>('/auth/me', {
      headers: harness.headers.forUser(user.id),
    });

    expect(response.status).toBe(200);
    expect(response.body?.id).toBe(user.id);
  });

  it('can call authenticated routes using API key helper headers', async () => {
    const user = await harness.factories.createUser();
    const response = await harness.request.get<{ id: string }>('/auth/me', {
      headers: await harness.headers.forApiKeyUser(user.id),
    });

    expect(response.status).toBe(200);
    expect(response.body?.id).toBe(user.id);
  });

  it('serializes query params and skips nullish values', async () => {
    const response = await harness.request.get<Record<string, string>>('/_test-harness/query', {
      query: {
        search: 'chat',
        page: 2,
        exact: false,
        ignoredNull: null,
        ignoredUndefined: undefined,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      exact: 'false',
      page: '2',
      search: 'chat',
    });
  });

  it('serializes json requests with the expected content type', async () => {
    const response = await harness.request.post<{
      contentType: string;
      body: { title: string; completed: boolean };
    }>('/_test-harness/json', {
      json: { title: 'Ship review', completed: false },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      contentType: 'application/json',
      body: { title: 'Ship review', completed: false },
    });
  });

  it('preserves plain-text responses without forcing json parsing', async () => {
    const response = await harness.request.get('/_test-harness/text');

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.text).toBe('plain text response');
  });
});
