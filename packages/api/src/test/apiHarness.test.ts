import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from './apiHarness.js';
import { createTestDatabase, type TestDatabase } from './testDb.js';

const describeWithTestDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithTestDatabase('api test harness', () => {
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
});
