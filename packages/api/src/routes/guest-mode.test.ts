/**
 * Guest-mode removal regression tests.
 *
 * `GUEST_MODE_VIEW_ONLY` used to synthesize a shared guest user for
 * unauthenticated callers. The API must now fail closed even if the stale env
 * flag is present.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { __testing as wsTesting } from '../ws/manager.js';

vi.mock('../tasks/db.js', () => ({
  clearTaskDbForTesting: () => {},
  getTaskDb: () => {
    throw new Error('Task DB should not be reached by unauthenticated guest-mode removal tests');
  },
}));

vi.mock('../deals/db.js', () => ({
  clearDealDbForTesting: () => {},
  getDealDb: () => {
    throw new Error('Deal DB should not be reached by unauthenticated guest-mode removal tests');
  },
}));

vi.mock('../storage.js', () => ({
  ATTACHMENT_BUCKET: 'attachments',
  supabase: null,
}));

describe('guest mode removal', () => {
  const originalGuestMode = process.env.GUEST_MODE_VIEW_ONLY;
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    process.env.GUEST_MODE_VIEW_ONLY = 'true';
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
    wsTesting.resetState();
    wsTesting.setDbForTesting(harness.db as any);
  });

  afterAll(async () => {
    if (originalGuestMode === undefined) {
      delete process.env.GUEST_MODE_VIEW_ONLY;
    } else {
      process.env.GUEST_MODE_VIEW_ONLY = originalGuestMode;
    }
    wsTesting.resetState();
    wsTesting.setDbForTesting(null);
    await harness.close();
  });

  async function fixture() {
    const owner = await harness.factories.createUser({
      email: 'owner@example.com',
      displayName: 'Owner',
    });
    const generalCh = await harness.factories.createChannel({
      name: 'general',
      slug: 'general',
      channelType: 'public',
      createdBy: owner.id,
    });
    const privateCh = await harness.factories.createChannel({
      name: 'private-room',
      slug: 'private-room',
      channelType: 'private',
      createdBy: owner.id,
    });
    return { owner, generalCh, privateCh };
  }

  it('ignores stale GUEST_MODE_VIEW_ONLY and returns 401 for former public channel reads', async () => {
    const { generalCh } = await fixture();

    const requests = [
      harness.request.get('/channels'),
      harness.request.get(`/channels/${generalCh.id}/messages`),
      harness.request.get(`/channels/${generalCh.id}/members`),
      harness.request.get('/channels/unread'),
      harness.request.get('/channels/presence'),
      harness.request.get('/messages/search', { query: { q: 'hello' } }),
    ];

    const responses = await Promise.all(requests);
    expect(responses.map((res) => res.status)).toEqual([401, 401, 401, 401, 401, 401]);
  });

  it('returns 401 for unauthenticated access to sensitive exposed surfaces', async () => {
    await fixture();

    const requests = [
      harness.request.get('/members'),
      harness.request.get('/tasks'),
      harness.request.post('/tasks', { json: { title: 'unauth task' } }),
      harness.request.get('/deals'),
      harness.request.get('/incidents'),
      harness.request.get('/metrics'),
      harness.request.get('/metrics/export', { query: { includeAll: true } }),
      harness.request.get('/activity', { query: { agentId: 'agent-user-id' } }),
      harness.request.post('/activity', { json: { agentUserId: 'agent-user-id', action: 'spoof' } }),
      harness.request.get('/status'),
      harness.request.put('/status', { json: { text: 'watching' } }),
      harness.request.get('/huddles'),
      harness.request.post('/tts/00000000-0000-4000-8000-000000000000'),
      harness.request.post('/uploads', { body: new FormData() }),
      harness.request.post('/auth/api-keys', { json: { name: 'guest key' } }),
    ];

    const responses = await Promise.all(requests);
    expect(responses.map((res) => res.status)).toEqual([
      401,
      401,
      401,
      401,
      401,
      401,
      401,
      401,
      401,
      401,
      401,
      401,
      401,
      401,
      401,
    ]);
  });

  it('keeps authenticated channel access working', async () => {
    const { owner, privateCh } = await fixture();

    const channels = await harness.request.get<any[]>('/channels', {
      headers: harness.headers.forUser(owner.id),
    });

    expect(channels.status).toBe(200);
    expect((channels.body ?? []).map((channel) => channel.id)).toContain(privateCh.id);
  });
});
