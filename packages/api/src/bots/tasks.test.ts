import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { messages, tasks } from '@blather/db';

vi.mock('../ws/events.js', () => ({ emitEvent: vi.fn(async () => {}) }));

import { handleTasksCommand } from './tasks.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

describe('TaskBot channel authorization', () => {
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

  it('keeps task listing and mutation scoped to the command channel', async () => {
    const owner = await testDatabase.factories.createUser();
    const outsider = await testDatabase.factories.createUser();
    const privateChannel = await testDatabase.factories.createChannel({
      channelType: 'private',
      createdBy: owner.id,
    });
    const otherChannel = await testDatabase.factories.createChannel({
      channelType: 'private',
      createdBy: outsider.id,
    });
    const [privateTask] = await testDatabase.db.insert(tasks).values({
      title: 'private task',
      creatorId: owner.id,
      sourceChannelId: privateChannel.id,
    }).returning();

    await handleTasksCommand(
      testDatabase.db,
      otherChannel.id,
      `@tasks done T#${privateTask.shortId}`,
      undefined,
      outsider.id,
    );

    const [stored] = await testDatabase.db.select().from(tasks)
      .where(eq(tasks.id, privateTask.id));
    expect(stored.status).toBe('queued');

    const messagesAfterDone = await testDatabase.db.select({ content: messages.content }).from(messages)
      .where(eq(messages.channelId, otherChannel.id));
    expect(messagesAfterDone.map((message) => message.content)).toContain(
      `❌ No task found matching "T#${privateTask.shortId}"`,
    );
    await testDatabase.db.insert(tasks).values([
      { title: 'hidden private task', creatorId: owner.id, sourceChannelId: privateChannel.id },
      { title: 'visible local task', creatorId: outsider.id, sourceChannelId: otherChannel.id },
    ]);

    await handleTasksCommand(testDatabase.db, otherChannel.id, '@tasks list', undefined, outsider.id);

    const botMessages = await testDatabase.db.select({ content: messages.content }).from(messages)
      .where(eq(messages.channelId, otherChannel.id));
    const list = botMessages.map((message) => message.content).find((content) => content.includes('Open Tasks'));
    expect(list).toContain('visible local task');
    expect(list).not.toContain('hidden private task');
  });
});
