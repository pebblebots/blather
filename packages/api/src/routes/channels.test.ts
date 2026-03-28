import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  channelMembers,
  channelReads,
  channels,
  messages,
  reactions,
} from '@blather/db';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

type MessageRow = {
  id: string;
  channelId: string;
  userId: string | null;
  content: string;
  threadId: string | null;
  attachments: Array<{ url: string; filename: string; contentType: string; size: number }> | null;
  createdAt: string;
  updatedAt: string;
};

describe('channel routes', () => {
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

  async function createFixture() {
    const owner = await harness.factories.createUser({ email: 'owner@example.com', displayName: 'Owner' });
    const member = await harness.factories.createUser({ email: 'member@example.com', displayName: 'Member' });
    const workspace = await harness.factories.createWorkspace({ ownerId: owner.id });
    const channel = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: 'general',
      slug: 'general',
      channelType: 'public',
      createdBy: owner.id,
    });

    return { owner, member, workspace, channel };
  }

  async function tick() {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  it('POST /channels/:id/messages creates a message and rejects exact duplicates within 60 seconds', async () => {
    const { owner, channel } = await createFixture();

    const first = await harness.request.post<MessageRow>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      json: {
        content: 'hello from test',
        attachments: [{ url: 'https://cdn.test/file.txt', filename: 'file.txt', contentType: 'text/plain', size: 42 }],
      },
    });

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      channelId: channel.id,
      userId: owner.id,
      content: 'hello from test',
    });

    const duplicate = await harness.request.post<{ error: string; existingId: string }>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'hello from test' },
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body?.error).toBe('Duplicate message');
    expect(duplicate.body?.existingId).toBe(first.body?.id);
  });

  it('POST /channels/:id/messages rejects API error messages with 422', async () => {
    const { owner, channel } = await createFixture();

    // Test cases that should be rejected
    const errorMessages = [
      'LLM error api_error: Internal server error (request_id: req_011CZS9d9fjBP1s2wPcSii9f)',
      'api_error: Rate limit exceeded',
      'Internal server error occurred while processing request',
      'Error with request_id: req_abc123',
      'authentication_error: Invalid API key',
      'permission_error: Access denied',
      'invalid_request_error: Bad request format',
      'not_found_error: Resource not found',
      '{"type": "error", "message": "Something went wrong"}',
      '{type: "error", code: 500}',
      'This request would exceed your rate limit',
      'LLM error: Something went wrong with the model',
    ];

    for (const content of errorMessages) {
      const response = await harness.request.post(`/channels/${channel.id}/messages`, {
        headers: harness.headers.forUser(owner.id),
        json: { content },
      });

      expect(response.status).toBe(422);
      expect((response.body as any)?.error).toMatch(/Message rejected.*API error/);
    }

    // Test cases that should be accepted (normal messages)
    const normalMessages = [
      'This is a normal message',
      'I got an error in my code but this is just chat',
      'API documentation says to use POST',
      'The internal server is working fine',
      'My request_id for the support ticket is 12345',
      'authentication works well',
      'permission to proceed granted',
    ];

    for (const content of normalMessages) {
      const response = await harness.request.post<MessageRow>(`/channels/${channel.id}/messages`, {
        headers: harness.headers.forUser(owner.id),
        json: { content },
      });

      expect(response.status).toBe(201);
      expect(response.body?.content).toBe(content);
    }
  });

  it('GET /channels/:id/messages supports pagination and excludes thread replies', async () => {
    const { owner, channel } = await createFixture();

    const first = await harness.factories.createMessage({ channelId: channel.id, userId: owner.id, content: 'first' });
    await tick();
    const second = await harness.factories.createMessage({ channelId: channel.id, userId: owner.id, content: 'second' });
    await harness.factories.createMessage({
      channelId: channel.id,
      userId: owner.id,
      content: 'thread-reply',
      threadId: first.id,
    });

    const latestOnly = await harness.request.get<MessageRow[]>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      query: { limit: 1 },
    });

    expect(latestOnly.status).toBe(200);
    expect(latestOnly.body).toHaveLength(1);
    expect(latestOnly.body?.[0]?.id).toBe(second.id);

    const afterFirst = await harness.request.get<MessageRow[]>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      query: { after: first.createdAt.toISOString() },
    });

    expect(afterFirst.status).toBe(200);
    const returnedIds = new Set(afterFirst.body?.map((message) => message.id));
    expect(returnedIds.has(second.id)).toBe(true);
    expect(returnedIds.has(first.id)).toBe(false);
  });

  it('POST /channels/:id/messages with threadId creates thread replies and GET replies returns them', async () => {
    const { owner, member, channel } = await createFixture();

    const parent = await harness.factories.createMessage({
      channelId: channel.id,
      userId: owner.id,
      content: 'parent message',
    });

    const replyResponse = await harness.request.post<MessageRow>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(member.id),
      json: {
        content: 'reply message',
        threadId: parent.id,
      },
    });

    expect(replyResponse.status).toBe(201);
    expect(replyResponse.body?.threadId).toBe(parent.id);

    const replies = await harness.request.get<MessageRow[]>(`/channels/${channel.id}/messages/${parent.id}/replies`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(replies.status).toBe(200);
    expect(replies.body?.map((message) => message.id)).toContain(replyResponse.body?.id);
  });

  it('POST /channels/:id/typing returns ok', async () => {
    const { owner, channel } = await createFixture();

    const response = await harness.request.post<{ ok: boolean }>(`/channels/${channel.id}/typing`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('can add, list, and remove reactions for a message', async () => {
    const { owner, channel } = await createFixture();
    const message = await harness.factories.createMessage({ channelId: channel.id, userId: owner.id, content: 'react to me' });

    const addReaction = await harness.request.post<{ id: string; emoji: string }>(
      `/channels/${channel.id}/messages/${message.id}/reactions`,
      {
        headers: harness.headers.forUser(owner.id),
        json: { emoji: '👍' },
      },
    );

    expect(addReaction.status).toBe(201);
    expect(addReaction.body?.emoji).toBe('👍');

    const getReactions = await harness.request.get<Array<{ id: string; emoji: string; userId: string }>>(
      `/channels/${channel.id}/messages/${message.id}/reactions`,
      { headers: harness.headers.forUser(owner.id) },
    );

    expect(getReactions.status).toBe(200);
    expect(getReactions.body).toHaveLength(1);
    expect(getReactions.body?.[0]).toMatchObject({ emoji: '👍', userId: owner.id });

    const removeReaction = await harness.request.delete<{ ok: boolean }>(
      `/channels/${channel.id}/messages/${message.id}/reactions`,
      {
        headers: harness.headers.forUser(owner.id),
        json: { emoji: '👍' },
      },
    );

    expect(removeReaction.status).toBe(200);
    expect(removeReaction.body).toEqual({ ok: true });

    const remaining = await harness.db.select().from(reactions).where(eq(reactions.messageId, message.id));
    expect(remaining).toHaveLength(0);
  });

  it('POST /channels/:id/read upserts channel read state', async () => {
    const { owner, channel } = await createFixture();

    const firstRead = await harness.request.post<{ ok: boolean }>(`/channels/${channel.id}/read`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(firstRead.status).toBe(200);
    expect(firstRead.body).toEqual({ ok: true });

    const secondRead = await harness.request.post<{ ok: boolean }>(`/channels/${channel.id}/read`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(secondRead.status).toBe(200);

    const reads = await harness.db
      .select()
      .from(channelReads)
      .where(and(eq(channelReads.channelId, channel.id), eq(channelReads.userId, owner.id)));

    expect(reads).toHaveLength(1);
  });

  it('invites members and GET /channels/:id/members returns the channel member list', async () => {
    const { owner, member, channel } = await createFixture();

    const invite = await harness.request.post<{ ok: boolean }>(`/channels/${channel.id}/members`, {
      headers: harness.headers.forUser(owner.id),
      json: { userId: member.id },
    });

    expect(invite.status).toBe(201);
    expect(invite.body).toEqual({ ok: true });

    const membersResponse = await harness.request.get<Array<{ id: string; email: string; displayName: string }>>(
      `/channels/${channel.id}/members`,
      { headers: harness.headers.forUser(owner.id) },
    );

    expect(membersResponse.status).toBe(200);
    const ids = new Set(membersResponse.body?.map((m) => m.id));
    expect(ids.has(owner.id)).toBe(true);
    expect(ids.has(member.id)).toBe(true);
  });

  it('PATCH /channels/:id/archive archives non-default channels', async () => {
    const { owner, channel } = await createFixture();

    const response = await harness.request.patch<{ archived: boolean }>(`/channels/${channel.id}/archive`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(response.status).toBe(200);
    expect(response.body?.archived).toBe(true);

    const [updated] = await harness.db.select().from(channels).where(eq(channels.id, channel.id));
    expect(updated?.archived).toBe(true);
  });

  it('PATCH /channels/:channelId/messages/:messageId edits a message', async () => {
    const { owner, channel } = await createFixture();
    const message = await harness.factories.createMessage({ channelId: channel.id, userId: owner.id, content: 'old text' });

    const response = await harness.request.patch<MessageRow>(`/channels/${channel.id}/messages/${message.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'new text' },
    });

    expect(response.status).toBe(200);
    expect(response.body?.content).toBe('new text');

    const [updated] = await harness.db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.content).toBe('new text');
  });

  it('DELETE /channels/:channelId/messages/:messageId deletes a message and its reactions', async () => {
    const { owner, channel } = await createFixture();
    const message = await harness.factories.createMessage({ channelId: channel.id, userId: owner.id, content: 'to delete' });

    await harness.db.insert(reactions).values({ messageId: message.id, userId: owner.id, emoji: '🔥' });

    const response = await harness.request.delete<{ ok: boolean }>(`/channels/${channel.id}/messages/${message.id}`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    const [remainingMessage] = await harness.db.select().from(messages).where(eq(messages.id, message.id));
    expect(remainingMessage).toBeUndefined();

    const remainingReactions = await harness.db.select().from(reactions).where(eq(reactions.messageId, message.id));
    expect(remainingReactions).toHaveLength(0);
  });

  it('rejects messages to DM channels from non-members', async () => {
    const { owner, member, workspace } = await createFixture();
    const outsider = await harness.factories.createUser({ email: 'outsider@example.com', displayName: 'Outsider' });
    const dm = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: 'dm',
      slug: 'dm-1',
      channelType: 'dm',
      createdBy: owner.id,
    });

    // Owner is auto-added as member by createChannel. Add member too.
    await harness.db.insert(channelMembers).values({ channelId: dm.id, userId: member.id });

    // Non-member cannot post
    const rejected = await harness.request.post<{ error: string }>(`/channels/${dm.id}/messages`, {
      headers: harness.headers.forUser(outsider.id),
      json: { content: 'sneaky' },
    });
    expect(rejected.status).toBe(403);

    // Non-member cannot read
    const readRejected = await harness.request.get<{ error: string }>(`/channels/${dm.id}/messages`, {
      headers: harness.headers.forUser(outsider.id),
    });
    expect(readRejected.status).toBe(403);

    // Member can post
    const allowed = await harness.request.post<MessageRow>(`/channels/${dm.id}/messages`, {
      headers: harness.headers.forUser(member.id),
      json: { content: 'hello from dm' },
    });
    expect(allowed.status).toBe(201);
  });

  it('rejects messages that look like raw API errors', async () => {
    const { owner, channel } = await createFixture();

    const apiErrorTexts = [
      'Error: 429 rate_limit_error: You have exceeded your API quota',
      'HTTP 500 internal server error from anthropic',
      'rate_limit_exceeded: Please try again in a moment',
    ];

    for (const errorText of apiErrorTexts) {
      const response = await harness.request.post<{ error: string }>(`/channels/${channel.id}/messages`, {
        headers: harness.headers.forUser(owner.id),
        json: { content: errorText },
      });
      expect(response.status).toBe(422);
    }

    // Normal messages are still allowed
    const normal = await harness.request.post<MessageRow>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'This is a totally normal message about error handling' },
    });
    expect(normal.status).toBe(201);
  });

  it('DELETE /channels/:id deletes the channel and dependent records', async () => {
    const { owner, channel } = await createFixture();
    const message = await harness.factories.createMessage({ channelId: channel.id, userId: owner.id, content: 'depends on channel' });

    const response = await harness.request.delete<{ ok: boolean }>(`/channels/${channel.id}`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    const [deletedChannel] = await harness.db.select().from(channels).where(eq(channels.id, channel.id));
    expect(deletedChannel).toBeUndefined();

    const [deletedMessage] = await harness.db.select().from(messages).where(eq(messages.id, message.id));
    expect(deletedMessage).toBeUndefined();

    const memberships = await harness.db.select().from(channelMembers).where(eq(channelMembers.channelId, channel.id));
    expect(memberships).toHaveLength(0);
  });

describe('Canvas data retrieval', () => {
  const canvasPayload = {
    html: '<h1>Test</h1>',
    title: 'Test Canvas',
    width: 400,
    height: 300
  };

  it('should return canvas data when fetching messages via GET', async () => {
    const { owner, channel } = await createFixture();
    
    // Create a message with canvas data
    const messageWithCanvas = await harness.factories.createMessage({
      channelId: channel.id,
      userId: owner.id,
      content: 'Message with canvas',
      canvas: canvasPayload
    });

    // Fetch messages via GET and verify canvas field is present
    const response = await harness.request.get<any[]>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);

    const message = response.body![0];
    expect(message.id).toBe(messageWithCanvas.id);
    expect(message.canvas).toEqual({
      ...canvasPayload,
      version: 1
    });
  });

  it('should return canvas data in around endpoint', async () => {
    const { owner, channel } = await createFixture();

    // Create a message with canvas data
    const messageWithCanvas = await harness.factories.createMessage({
      channelId: channel.id,
      userId: owner.id,
      content: 'Message with canvas for around test',
      canvas: canvasPayload
    });

    // Test the "around" endpoint (uses ?around= query param)
    const response = await harness.request.get<any[]>(
      `/channels/${channel.id}/messages?around=${messageWithCanvas.id}`,
      {
        headers: harness.headers.forUser(owner.id),
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);

    const message = response.body![0];
    expect(message.id).toBe(messageWithCanvas.id);
    expect(message.canvas).toEqual({
      ...canvasPayload,
      version: 1
    });
  });

  it('should return canvas data in thread replies', async () => {
    const { owner, channel } = await createFixture();

    // Create a parent message
    const parentMessage = await harness.factories.createMessage({
      channelId: channel.id,
      userId: owner.id,
      content: 'Parent message'
    });

    // Create a thread reply with canvas data
    const replyWithCanvas = await harness.factories.createMessage({
      channelId: channel.id,
      userId: owner.id,
      content: 'Reply with canvas',
      threadId: parentMessage.id,
      canvas: canvasPayload
    });

    // Fetch thread replies and verify canvas field is present
    const response = await harness.request.get<any[]>(
      `/channels/${channel.id}/messages/${parentMessage.id}/replies`,
      {
        headers: harness.headers.forUser(owner.id),
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);

    const reply = response.body![0];
    expect(reply.id).toBe(replyWithCanvas.id);
    expect(reply.canvas).toEqual({
      ...canvasPayload,
      version: 1
    });
  });

  it('should handle messages without canvas data gracefully', async () => {
    const { owner, channel } = await createFixture();

    // Create a message without canvas data
    const regularMessage = await harness.factories.createMessage({
      channelId: channel.id,
      userId: owner.id,
      content: 'Regular message without canvas'
    });

    // Fetch messages via GET
    const response = await harness.request.get<any[]>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);

    const message = response.body![0];
    expect(message.id).toBe(regularMessage.id);
    expect(message.canvas).toBeNull();
  });
});
});
