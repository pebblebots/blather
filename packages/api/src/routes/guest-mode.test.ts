/**
 * Guest-mode route tests (T#161).
 *
 * Covers the view-only unauthenticated path enabled by
 * `GUEST_MODE_VIEW_ONLY=true`:
 *   - flag OFF -> 401 preserved (no regression)
 *   - flag ON  + unauth + GET /channels      -> public channels only
 *   - flag ON  + unauth + GET /channels/:private/messages -> 403
 *   - flag ON  + unauth + POST /channels/:id/messages     -> 403
 *   - flag ON  + authenticated user          -> normal behavior
 *   - flag ON  + unauth + WS subscribe to private -> no event delivered
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { _setGuestModeForTesting, GUEST_USER_ID } from '../config/guest-mode.js';
import { publishEvent, __testing as wsTesting } from '../ws/manager.js';

describe('guest mode (T#161)', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
    // All tests here can trigger the WS event path (e.g. message.created).
    // Wire the WS manager's module-scope db to the harness pglite so those
    // DB queries resolve locally instead of trying real Postgres.
    wsTesting.setDbForTesting(harness.db as any);
  });

  afterEach(() => {
    _setGuestModeForTesting(undefined);
    wsTesting.resetState();
    wsTesting.setDbForTesting(null);
  });

  afterAll(async () => {
    await harness.close();
  });

  async function fixture() {
    const owner = await harness.factories.createUser({ email: 'owner@example.com', displayName: 'Owner' });
    const publicCh = await harness.factories.createChannel({
      name: 'public-room', slug: 'public-room', channelType: 'public', createdBy: owner.id,
    });
    const privateCh = await harness.factories.createChannel({
      name: 'private-room', slug: 'private-room', channelType: 'private', createdBy: owner.id,
    });
    await harness.factories.createMessage({ channelId: publicCh.id, userId: owner.id, content: 'public hello' });
    await harness.factories.createMessage({ channelId: privateCh.id, userId: owner.id, content: 'secret' });
    return { owner, publicCh, privateCh };
  }

  it('flag OFF: unauthenticated request still returns 401', async () => {
    _setGuestModeForTesting(false);
    await fixture();
    const res = await harness.request.get('/channels');
    expect(res.status).toBe(401);
  });

  it('flag ON + unauth GET /channels: returns public channels only', async () => {
    _setGuestModeForTesting(true);
    const { publicCh, privateCh } = await fixture();

    const res = await harness.request.get<any[]>('/channels');
    expect(res.status).toBe(200);
    const ids = (res.body ?? []).map((c) => c.id);
    expect(ids).toContain(publicCh.id);
    expect(ids).not.toContain(privateCh.id);
    // All returned channels must be public
    for (const ch of res.body ?? []) {
      expect(ch.channelType).toBe('public');
    }
  });

  it('flag ON + unauth GET /channels/:public/messages: returns messages', async () => {
    _setGuestModeForTesting(true);
    const { publicCh } = await fixture();

    const res = await harness.request.get<any[]>(`/channels/${publicCh.id}/messages`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body ?? []).some((m: any) => m.content === 'public hello')).toBe(true);
  });

  it('flag ON + unauth GET /channels/:private/messages: 403', async () => {
    _setGuestModeForTesting(true);
    const { privateCh } = await fixture();

    const res = await harness.request.get(`/channels/${privateCh.id}/messages`);
    expect(res.status).toBe(403);
  });

  it('flag ON + unauth POST /channels/:id/messages: 403', async () => {
    _setGuestModeForTesting(true);
    const { publicCh } = await fixture();

    const res = await harness.request.post(`/channels/${publicCh.id}/messages`, {
      json: { content: 'I am a guest trying to post' },
    });
    expect(res.status).toBe(403);
  });

  it('flag ON + unauth POST /channels/:id/members: 403', async () => {
    _setGuestModeForTesting(true);
    const { publicCh } = await fixture();

    const res = await harness.request.post(`/channels/${publicCh.id}/members`, {
      json: { userId: 'some-user' },
    });
    expect(res.status).toBe(403);
  });

  it('flag ON + unauth POST /channels/:id/messages/:mid/reactions: 403', async () => {
    _setGuestModeForTesting(true);
    const { publicCh } = await fixture();
    // grab a message id
    const msgs = await harness.request.get<any[]>(`/channels/${publicCh.id}/messages`);
    const msgId = msgs.body?.[0]?.id;
    expect(msgId).toBeDefined();

    const res = await harness.request.post(`/channels/${publicCh.id}/messages/${msgId}/reactions`, {
      json: { emoji: '👍' },
    });
    expect(res.status).toBe(403);
  });

  it('flag ON + authenticated user still behaves normally (sees private they are member of)', async () => {
    _setGuestModeForTesting(true);
    const { owner, privateCh } = await fixture();

    const res = await harness.request.get<any[]>('/channels', {
      headers: harness.headers.forUser(owner.id),
    });
    expect(res.status).toBe(200);
    const ids = (res.body ?? []).map((c) => c.id);
    expect(ids).toContain(privateCh.id);
  });

  it('flag ON + authenticated user can still post messages', async () => {
    _setGuestModeForTesting(true);
    const { owner, publicCh } = await fixture();

    const res = await harness.request.post(`/channels/${publicCh.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'owner message after flag flip' },
    });
    expect(res.status).toBe(201);
  });

  it('flag ON + unauth: private-channel member list is 403', async () => {
    _setGuestModeForTesting(true);
    const { privateCh } = await fixture();

    const res = await harness.request.get(`/channels/${privateCh.id}/members`);
    expect(res.status).toBe(403);
  });

  it('flag ON + unauth: unread counts return empty object (not 401)', async () => {
    _setGuestModeForTesting(true);
    await fixture();

    const res = await harness.request.get<Record<string, number>>('/channels/unread');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('flag ON + guest WS client: does not receive events on private channels', async () => {
    _setGuestModeForTesting(true);
    const { privateCh } = await fixture();
    wsTesting.setDbForTesting(harness.db as any);

    const sent: string[] = [];
    const fakeWs: any = {
      readyState: 1, // WebSocket.OPEN
      send: (data: string) => sent.push(data),
      ping: () => {},
      on: () => {},
      once: () => {},
      close: () => {},
      terminate: () => {},
    };
    wsTesting.setupAuthedClient(fakeWs, GUEST_USER_ID);

    await publishEvent({
      type: 'message.created',
      channel_id: privateCh.id,
      data: { id: 'x', content: 'secret' },
    });

    const relevant = sent.filter((s) => !s.includes('"type":"connected"'));
    expect(relevant.length).toBe(0);
  });

  it('flag ON + guest WS client: does receive events on public channels', async () => {
    _setGuestModeForTesting(true);
    const { publicCh } = await fixture();
    wsTesting.setDbForTesting(harness.db as any);

    const sent: string[] = [];
    const fakeWs: any = {
      readyState: 1,
      send: (data: string) => sent.push(data),
      ping: () => {},
      on: () => {},
      once: () => {},
      close: () => {},
      terminate: () => {},
    };
    wsTesting.setupAuthedClient(fakeWs, GUEST_USER_ID);

    await publishEvent({
      type: 'message.created',
      channel_id: publicCh.id,
      data: { id: 'y', content: 'hi' },
    });

    const relevant = sent.filter((s) => !s.includes('"type":"connected"'));
    expect(relevant.length).toBeGreaterThanOrEqual(1);
  });
});
