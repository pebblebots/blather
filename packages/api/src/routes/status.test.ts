import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ws/manager.js', () => ({
  broadcastStatusForUser: vi.fn(),
}));

import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { clearAgentStatus, getAllStatuses } from '../state/agentStatus.js';
import { broadcastStatusForUser } from '../ws/manager.js';

describe('status routes', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
    for (const userId of Array.from(getAllStatuses().keys())) {
      clearAgentStatus(userId);
    }
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('PUT /status trims the text, stores the status, and broadcasts it', async () => {
    const user = await harness.factories.createUser();

    const response = await harness.request.put<{ ok: boolean; status: { text: string; progress?: number; eta?: string } }>('/status', {
      headers: harness.headers.forUser(user.id),
      json: {
        text: '  Reviewing module  ',
        progress: 0.25,
        eta: '2m',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      status: {
        text: 'Reviewing module',
        progress: 0.25,
        eta: '2m',
      },
    });
    expect(broadcastStatusForUser).toHaveBeenCalledTimes(1);
    expect(broadcastStatusForUser).toHaveBeenCalledWith(user.id, {
      text: 'Reviewing module',
      progress: 0.25,
      eta: '2m',
    });
  });

  it('PUT /status rejects whitespace-only text', async () => {
    const user = await harness.factories.createUser();

    const response = await harness.request.put<{ error: string }>('/status', {
      headers: harness.headers.forUser(user.id),
      json: { text: '   ' },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'text is required' });
    expect(broadcastStatusForUser).not.toHaveBeenCalled();
  });

  it('PUT /status rejects progress values outside 0..1', async () => {
    const user = await harness.factories.createUser();

    const response = await harness.request.put<{ error: string }>('/status', {
      headers: harness.headers.forUser(user.id),
      json: {
        text: 'Reviewing module',
        progress: 2,
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'progress must be a number between 0 and 1' });
    expect(broadcastStatusForUser).not.toHaveBeenCalled();
  });

  it('GET /status returns all active statuses keyed by user id', async () => {
    const firstUser = await harness.factories.createUser();
    const secondUser = await harness.factories.createUser();

    await harness.request.put('/status', {
      headers: harness.headers.forUser(firstUser.id),
      json: { text: 'First status' },
    });
    await harness.request.put('/status', {
      headers: harness.headers.forUser(secondUser.id),
      json: { text: 'Second status', progress: 0.5 },
    });

    const response = await harness.request.get<Record<string, { text: string; progress?: number }>>('/status', {
      headers: harness.headers.forUser(firstUser.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      [firstUser.id]: { text: 'First status' },
      [secondUser.id]: { text: 'Second status', progress: 0.5 },
    });
  });

  it('DELETE /status clears the current user status and broadcasts the removal', async () => {
    const user = await harness.factories.createUser();

    await harness.request.put('/status', {
      headers: harness.headers.forUser(user.id),
      json: { text: 'Temporary status' },
    });
    vi.clearAllMocks();

    const response = await harness.request.delete<{ ok: boolean }>('/status', {
      headers: harness.headers.forUser(user.id),
    });
    const allStatuses = await harness.request.get<Record<string, { text: string }>>('/status', {
      headers: harness.headers.forUser(user.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(allStatuses.body).toEqual({});
    expect(broadcastStatusForUser).toHaveBeenCalledTimes(1);
    expect(broadcastStatusForUser).toHaveBeenCalledWith(user.id, null);
  });
});
