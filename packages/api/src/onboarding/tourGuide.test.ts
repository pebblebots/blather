import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { users, channels, channelMembers, messages, workspaceMembers } from '@blather/db';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { ensureTourGuideUser, buildWelcomeMessage, sendTourGuideWelcome } from './tourGuide.js';

describe('Tour Guide onboarding', () => {
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

  describe('ensureTourGuideUser', () => {
    it('creates the Tour Guide user when it does not exist', async () => {
      const tourGuide = await ensureTourGuideUser(testDatabase.db);

      expect(tourGuide.email).toBe('tourguide@system.blather');
      expect(tourGuide.displayName).toBe('Tour Guide');
      expect(tourGuide.isAgent).toBe(true);
    });

    it('returns the existing Tour Guide user without creating a duplicate', async () => {
      const first = await ensureTourGuideUser(testDatabase.db);
      const second = await ensureTourGuideUser(testDatabase.db);

      expect(first.id).toBe(second.id);

      // Verify only one Tour Guide exists
      const allTourGuides = await testDatabase.db.select().from(users)
        .where(eq(users.email, 'tourguide@system.blather'));
      expect(allTourGuides).toHaveLength(1);
    });
  });

  describe('buildWelcomeMessage', () => {
    it('includes the workspace name', () => {
      const msg = buildWelcomeMessage('Acme Corp');
      expect(msg).toContain('Acme Corp');
    });

    it('includes orientation tips', () => {
      const msg = buildWelcomeMessage('Test');
      expect(msg).toContain('#intros');
      expect(msg).toContain('DM anyone');
    });
  });

  describe('sendTourGuideWelcome', () => {
    it('sends a welcome DM to human users on workspace join', async () => {
      const user = await testDatabase.factories.createUser({ isAgent: false });
      const workspace = await testDatabase.factories.createWorkspace({ name: 'Acme Corp' });

      await sendTourGuideWelcome(testDatabase.db, user.id, workspace.id, workspace.name, false);

      // Verify Tour Guide user was created
      const [tourGuide] = await testDatabase.db.select().from(users)
        .where(eq(users.email, 'tourguide@system.blather'))
        .limit(1);
      expect(tourGuide).toBeDefined();

      // Verify a DM channel was created
      const dmChannels = await testDatabase.db.select().from(channels)
        .where(and(
          eq(channels.workspaceId, workspace.id),
          eq(channels.channelType, 'dm'),
        ));
      expect(dmChannels).toHaveLength(1);

      // Verify both users are channel members
      const members = await testDatabase.db.select().from(channelMembers)
        .where(eq(channelMembers.channelId, dmChannels[0].id));
      const memberUserIds = members.map(m => m.userId).sort();
      expect(memberUserIds).toEqual([tourGuide!.id, user.id].sort());

      // Verify welcome message was sent
      const msgs = await testDatabase.db.select().from(messages)
        .where(eq(messages.channelId, dmChannels[0].id));
      expect(msgs).toHaveLength(1);
      expect(msgs[0].userId).toBe(tourGuide!.id);
      expect(msgs[0].content).toContain('Acme Corp');
      expect(msgs[0].content).toContain('Welcome');
    });

    it('does NOT send a welcome DM to agent users', async () => {
      const agent = await testDatabase.factories.createUser({ isAgent: true });
      const workspace = await testDatabase.factories.createWorkspace({ name: 'Acme Corp' });

      await sendTourGuideWelcome(testDatabase.db, agent.id, workspace.id, workspace.name, true);

      // Verify no DM channels were created
      const dmChannels = await testDatabase.db.select().from(channels)
        .where(and(
          eq(channels.workspaceId, workspace.id),
          eq(channels.channelType, 'dm'),
        ));
      expect(dmChannels).toHaveLength(0);

      // Verify no messages were sent
      const allMessages = await testDatabase.db.select().from(messages);
      expect(allMessages).toHaveLength(0);
    });

    it('adds Tour Guide as workspace member', async () => {
      const user = await testDatabase.factories.createUser({ isAgent: false });
      const workspace = await testDatabase.factories.createWorkspace({ name: 'Test WS' });

      await sendTourGuideWelcome(testDatabase.db, user.id, workspace.id, workspace.name, false);

      const tourGuide = await ensureTourGuideUser(testDatabase.db);
      const [wsMember] = await testDatabase.db.select().from(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, workspace.id),
          eq(workspaceMembers.userId, tourGuide.id),
        )).limit(1);

      expect(wsMember).toBeDefined();
    });

    it('welcome message mentions the workspace name', async () => {
      const user = await testDatabase.factories.createUser({ isAgent: false });
      const workspace = await testDatabase.factories.createWorkspace({ name: 'Cool Startup' });

      await sendTourGuideWelcome(testDatabase.db, user.id, workspace.id, workspace.name, false);

      const dmChannels = await testDatabase.db.select().from(channels)
        .where(and(
          eq(channels.workspaceId, workspace.id),
          eq(channels.channelType, 'dm'),
        ));

      const [msg] = await testDatabase.db.select().from(messages)
        .where(eq(messages.channelId, dmChannels[0].id))
        .limit(1);

      expect(msg.content).toContain('Cool Startup');
    });
  });
});
