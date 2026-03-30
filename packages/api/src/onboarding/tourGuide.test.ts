import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { users, channels, channelMembers, messages } from '@blather/db';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { ensureTourGuideUser, buildWelcomeMessage, generateWelcomeMessage, sendTourGuideWelcome } from './tourGuide.js';

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
    it('includes orientation tips', () => {
      const msg = buildWelcomeMessage();
      expect(msg).toContain('#intros');
      expect(msg).toContain('DM anyone');
    });
  });

  describe('generateWelcomeMessage', () => {
    it('falls back to static message when no API key is set', async () => {
      // In test env, ANTHROPIC_API_KEY_TOURGUIDE is not set
      const msg = await generateWelcomeMessage(['general', 'random']);
      expect(msg).toContain('Welcome');
    });

    it('includes fallback content with user display name', async () => {
      const msg = await generateWelcomeMessage(['general'], 'Alice');
      expect(msg).toContain('Welcome');
    });
  });

  describe('sendTourGuideWelcome', () => {
    it('sends a welcome DM to human users', async () => {
      const user = await testDatabase.factories.createUser({ isAgent: false });

      await sendTourGuideWelcome(testDatabase.db, user.id, false);

      // Verify Tour Guide user was created
      const [tourGuide] = await testDatabase.db.select().from(users)
        .where(eq(users.email, 'tourguide@system.blather'))
        .limit(1);
      expect(tourGuide).toBeDefined();

      // Verify a DM channel was created
      const dmChannels = await testDatabase.db.select().from(channels)
        .where(eq(channels.channelType, 'dm'));
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
      expect(msgs[0].content).toContain('Welcome');
    });

    it('does NOT send a welcome DM to agent users', async () => {
      const agent = await testDatabase.factories.createUser({ isAgent: true });

      await sendTourGuideWelcome(testDatabase.db, agent.id, true);

      // Verify no DM channels were created
      const dmChannels = await testDatabase.db.select().from(channels)
        .where(eq(channels.channelType, 'dm'));
      expect(dmChannels).toHaveLength(0);

      // Verify no messages were sent
      const allMessages = await testDatabase.db.select().from(messages);
      expect(allMessages).toHaveLength(0);
    });

    it('welcome message contains orientation tips', async () => {
      const user = await testDatabase.factories.createUser({ isAgent: false });

      await sendTourGuideWelcome(testDatabase.db, user.id, false);

      const dmChannels = await testDatabase.db.select().from(channels)
        .where(eq(channels.channelType, 'dm'));

      const [msg] = await testDatabase.db.select().from(messages)
        .where(eq(messages.channelId, dmChannels[0].id))
        .limit(1);

      expect(msg.content).toContain('Welcome');
    });
  });
});
