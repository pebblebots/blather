// Regression tests for the 2026-05-19 external security disclosure.
//
// Four high-impact authorization issues against Blather's API surface,
// reported by an independent researcher and reproduced against the live
// yappers.world deployment + the codebase:
//
//   #1  GET /members leaked the full directory to guests on guest-mode
//        deployments (UUIDs + emails + isAgent flags).
//   #3a GET /channels/:channelId/messages/:messageId/replies had no
//        channel membership / type check at all.
//   #3b GET /channels/:channelId/messages/:messageId/reactions had no
//        channel membership / type check at all and didn't even verify
//        the messageId actually lived in the requested channel.
//   #4  DELETE /channels/:id was a free-for-all — any authenticated user
//        could delete any channel regardless of membership or role.
//
// These tests pin the fixes and document the intended behavior so we
// don't regress.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { channelMembers, channels, messages, reactions, users } from '@blather/db';
import { _setGuestModeForTesting } from '../config/guest-mode.js';
import { __testing as wsTesting } from '../ws/manager.js';
import { eq } from 'drizzle-orm';

describe('security disclosure 2026-05-19', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
    // DELETE /channels emits a `channel.deleted` event which the WS
    // manager dispatches via its module-scope db. Point it at the test
    // pglite so those queries resolve locally.
    wsTesting.setDbForTesting(harness.db as any);
  });

  afterEach(() => {
    _setGuestModeForTesting(undefined);
    wsTesting.setDbForTesting(null);
  });

  afterAll(async () => {
    await harness.close();
  });

  // ── #1: Member directory leak on guest-mode deployments ────────────────
  describe('#1 GET /members — guests cannot fetch directory', () => {
    it('rejects unauthenticated requests when guest mode is on', async () => {
      _setGuestModeForTesting(true);
      await harness.factories.createUser({ email: 'a@example.com', displayName: 'A' });
      await harness.factories.createUser({ email: 'b@example.com', displayName: 'B' });

      const res = await harness.request.get('/members');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/sign in/i) });
    });

    it('still rejects unauthenticated requests when guest mode is off (defense in depth)', async () => {
      _setGuestModeForTesting(false);
      const res = await harness.request.get('/members');
      expect(res.status).toBe(401);
    });

    it('still allows authenticated members to read the directory', async () => {
      _setGuestModeForTesting(true);
      const user = await harness.factories.createUser({ email: 'm@example.com', displayName: 'M' });
      const res = await harness.request.get<unknown[]>('/members', {
        headers: harness.headers.forUser(user.id),
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect((res.body ?? []).length).toBeGreaterThan(0);
    });
  });

  // ── #3a: Thread replies IDOR ──────────────────────────────────────────
  describe('#3a GET /channels/:c/messages/:m/replies — requires channel access', () => {
    it('returns 403 for a non-member of a private channel', async () => {
      const owner = await harness.factories.createUser({ email: 'o@example.com' });
      const outsider = await harness.factories.createUser({ email: 'x@example.com' });
      const channel = await harness.factories.createChannel({
        name: 'priv', slug: 'priv', channelType: 'private', createdBy: owner.id,
      });
      const parent = await harness.factories.createMessage({
        channelId: channel.id, userId: owner.id, content: 'secret parent',
      });
      await harness.factories.createMessage({
        channelId: channel.id, userId: owner.id, threadId: parent.id, content: 'secret reply',
      });

      const res = await harness.request.get(
        `/channels/${channel.id}/messages/${parent.id}/replies`,
        { headers: harness.headers.forUser(outsider.id) },
      );
      expect(res.status).toBe(403);
    });

    it('returns 404 when channelId in URL does not match the message channel', async () => {
      const owner = await harness.factories.createUser({ email: 'o2@example.com' });
      const pub = await harness.factories.createChannel({
        name: 'pub', slug: 'pub', channelType: 'public', createdBy: owner.id,
      });
      const otherPub = await harness.factories.createChannel({
        name: 'pub2', slug: 'pub2', channelType: 'public', createdBy: owner.id,
      });
      const parent = await harness.factories.createMessage({
        channelId: pub.id, userId: owner.id, content: 'real parent',
      });

      const res = await harness.request.get(
        `/channels/${otherPub.id}/messages/${parent.id}/replies`,
        { headers: harness.headers.forUser(owner.id) },
      );
      expect(res.status).toBe(404);
    });

    it('still lets a private-channel member fetch replies', async () => {
      const owner = await harness.factories.createUser({ email: 'o3@example.com' });
      const channel = await harness.factories.createChannel({
        name: 'priv3', slug: 'priv3', channelType: 'private', createdBy: owner.id,
      });
      const parent = await harness.factories.createMessage({
        channelId: channel.id, userId: owner.id, content: 'p',
      });
      await harness.factories.createMessage({
        channelId: channel.id, userId: owner.id, threadId: parent.id, content: 'r',
      });

      const res = await harness.request.get<unknown[]>(
        `/channels/${channel.id}/messages/${parent.id}/replies`,
        { headers: harness.headers.forUser(owner.id) },
      );
      expect(res.status).toBe(200);
      expect((res.body ?? []).length).toBe(1);
    });
  });

  // ── #3b: Reactions IDOR ───────────────────────────────────────────────
  describe('#3b GET /channels/:c/messages/:m/reactions — requires channel access', () => {
    it('returns 403 for a non-member of a private channel', async () => {
      const owner = await harness.factories.createUser({ email: 'o4@example.com' });
      const outsider = await harness.factories.createUser({ email: 'x4@example.com' });
      const channel = await harness.factories.createChannel({
        name: 'privR', slug: 'privR', channelType: 'private', createdBy: owner.id,
      });
      const m = await harness.factories.createMessage({
        channelId: channel.id, userId: owner.id, content: 'reacted',
      });
      await testDatabase.db.insert(reactions).values({
        messageId: m.id, userId: owner.id, emoji: '👀',
      });

      const res = await harness.request.get(
        `/channels/${channel.id}/messages/${m.id}/reactions`,
        { headers: harness.headers.forUser(outsider.id) },
      );
      expect(res.status).toBe(403);
    });

    it('returns 404 when channelId in URL does not match the message channel', async () => {
      const owner = await harness.factories.createUser({ email: 'o5@example.com' });
      const a = await harness.factories.createChannel({
        name: 'a', slug: 'aaa', channelType: 'public', createdBy: owner.id,
      });
      const b = await harness.factories.createChannel({
        name: 'b', slug: 'bbb', channelType: 'public', createdBy: owner.id,
      });
      const m = await harness.factories.createMessage({
        channelId: a.id, userId: owner.id, content: 'x',
      });
      const res = await harness.request.get(
        `/channels/${b.id}/messages/${m.id}/reactions`,
        { headers: harness.headers.forUser(owner.id) },
      );
      expect(res.status).toBe(404);
    });
  });

  // ── #4: DELETE /channels/:id authorization (CRITICAL) ─────────────────
  describe('#4 DELETE /channels/:id — only creator+member or workspace admin', () => {
    it('rejects an unrelated authenticated member with 403', async () => {
      const creator = await harness.factories.createUser({ email: 'c@example.com' });
      const stranger = await harness.factories.createUser({ email: 's@example.com' });
      const channel = await harness.factories.createChannel({
        name: 'victim', slug: 'victim', channelType: 'public', createdBy: creator.id,
      });

      const res = await harness.request.delete(`/channels/${channel.id}`, {
        headers: harness.headers.forUser(stranger.id),
      });
      expect(res.status).toBe(403);

      // Channel must still exist.
      const [stillThere] = await testDatabase.db
        .select().from(channels).where(eq(channels.id, channel.id)).limit(1);
      expect(stillThere).toBeTruthy();
    });

    it('rejects an unrelated member from deleting a private channel they cannot read', async () => {
      const creator = await harness.factories.createUser({ email: 'c2@example.com' });
      const outsider = await harness.factories.createUser({ email: 'o6@example.com' });
      const channel = await harness.factories.createChannel({
        name: 'sekrit', slug: 'sekrit', channelType: 'private', createdBy: creator.id,
      });

      const res = await harness.request.delete(`/channels/${channel.id}`, {
        headers: harness.headers.forUser(outsider.id),
      });
      expect(res.status).toBe(403);

      const [stillThere] = await testDatabase.db
        .select().from(channels).where(eq(channels.id, channel.id)).limit(1);
      expect(stillThere).toBeTruthy();
    });

    it('refuses to delete a default channel even by the creator', async () => {
      const creator = await harness.factories.createUser({ email: 'c3@example.com' });
      const channel = await harness.factories.createChannel({
        name: 'general', slug: 'general-x', channelType: 'public',
        isDefault: true, createdBy: creator.id,
      });
      const res = await harness.request.delete(`/channels/${channel.id}`, {
        headers: harness.headers.forUser(creator.id),
      });
      expect(res.status).toBe(400);
    });

    it('allows the channel creator (who is also a member) to delete a non-default channel', async () => {
      const creator = await harness.factories.createUser({ email: 'c4@example.com' });
      const channel = await harness.factories.createChannel({
        name: 'mine', slug: 'mine', channelType: 'public', createdBy: creator.id,
      });
      // factories.createChannel auto-adds creator as member.
      const res = await harness.request.delete(`/channels/${channel.id}`, {
        headers: harness.headers.forUser(creator.id),
      });
      expect(res.status).toBe(200);
      const [gone] = await testDatabase.db
        .select().from(channels).where(eq(channels.id, channel.id)).limit(1);
      expect(gone).toBeUndefined();
    });

    it('allows a workspace admin to delete a non-default channel they did not create', async () => {
      const creator = await harness.factories.createUser({ email: 'c5@example.com' });
      const admin = await harness.factories.createUser({ email: 'a5@example.com' });
      await testDatabase.db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));

      const channel = await harness.factories.createChannel({
        name: 'other', slug: 'other', channelType: 'private', createdBy: creator.id,
      });

      const res = await harness.request.delete(`/channels/${channel.id}`, {
        headers: harness.headers.forUser(admin.id),
      });
      expect(res.status).toBe(200);
    });

    it('rejects the creator if they are no longer a member of the channel', async () => {
      // Edge case: creator left the channel. They should not be able to
      // remotely nuke it after departure.
      const creator = await harness.factories.createUser({ email: 'c6@example.com' });
      const channel = await harness.factories.createChannel({
        name: 'left', slug: 'left', channelType: 'private', createdBy: creator.id,
      });
      await testDatabase.db
        .delete(channelMembers)
        .where(eq(channelMembers.channelId, channel.id));

      const res = await harness.request.delete(`/channels/${channel.id}`, {
        headers: harness.headers.forUser(creator.id),
      });
      expect(res.status).toBe(403);
    });
  });
});
