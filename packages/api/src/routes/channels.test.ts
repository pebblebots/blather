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
import { _resetRateLimiter } from './channels.js';

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
    _resetRateLimiter();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function createFixture() {
    const owner = await harness.factories.createUser({ email: 'owner@example.com', displayName: 'Owner' });
    const member = await harness.factories.createUser({ email: 'member@example.com', displayName: 'Member' });
    const channel = await harness.factories.createChannel({
      name: 'general',
      slug: 'general',
      channelType: 'public',
      createdBy: owner.id,
    });

    return { owner, member, channel };
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
      '⚠️ Agent failed before reply: rate limit exceeded.\nLogs: openclaw logs --follow',
      '⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model.',
      '⚠️ Message ordering conflict - please try again.',
      'All models failed after retry',
      'Embedded agent failed before reply: timeout',
      'Image model failed (openai/dall-e-3): quota exceeded',
      'PDF model failed (anthropic/claude-3): rate limit',
      'Followup agent failed before reply: connection error',
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
    const { owner, member } = await createFixture();
    const outsider = await harness.factories.createUser({ email: 'outsider@example.com', displayName: 'Outsider' });
    const dm = await harness.factories.createChannel({
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

describe('channel creation', () => {
  it('POST /channels creates a channel and auto-joins the creator', async () => {
    const owner = await harness.factories.createUser({ email: 'creator@example.com', displayName: 'Creator' });

    const res = await harness.request.post<any>('/channels', {
      headers: harness.headers.forUser(owner.id),
      json: { name: 'new-channel', slug: 'new-channel', channelType: 'public' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'new-channel', slug: 'new-channel', channelType: 'public' });

    // Creator should be auto-joined
    const members = await harness.db.select().from(channelMembers)
      .where(eq(channelMembers.channelId, res.body.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(owner.id);
  });

  it('POST /channels returns 409 on duplicate slug', async () => {
    const owner = await harness.factories.createUser({ email: 'dup@example.com', displayName: 'Dup' });

    const first = await harness.request.post<any>('/channels', {
      headers: harness.headers.forUser(owner.id),
      json: { name: 'taken', slug: 'taken-slug', channelType: 'public' },
    });
    expect(first.status).toBe(201);

    const second = await harness.request.post<{ error: string }>('/channels', {
      headers: harness.headers.forUser(owner.id),
      json: { name: 'different-name', slug: 'taken-slug', channelType: 'public' },
    });
    expect(second.status).toBe(409);
    expect(second.body?.error).toMatch(/slug already exists/);
  });

  it('POST /channels/dm creates a DM and returns it on repeat calls', async () => {
    const userA = await harness.factories.createUser({ email: 'dm-a@example.com', displayName: 'A' });
    const userB = await harness.factories.createUser({ email: 'dm-b@example.com', displayName: 'B' });

    const first = await harness.request.post<any>('/channels/dm', {
      headers: harness.headers.forUser(userA.id),
      json: { userId: userB.id },
    });
    expect(first.status).toBe(201);
    expect(first.body?.channelType).toBe('dm');

    // Both users should be members
    const members = await harness.db.select().from(channelMembers)
      .where(eq(channelMembers.channelId, first.body.id));
    expect(members).toHaveLength(2);

    // Second call returns the same channel
    const second = await harness.request.post<any>('/channels/dm', {
      headers: harness.headers.forUser(userA.id),
      json: { userId: userB.id },
    });
    expect(second.status).toBe(200);
    expect(second.body?.id).toBe(first.body?.id);

    // Reversed caller also returns the same channel
    const reversed = await harness.request.post<any>('/channels/dm', {
      headers: harness.headers.forUser(userB.id),
      json: { userId: userA.id },
    });
    expect(reversed.status).toBe(200);
    expect(reversed.body?.id).toBe(first.body?.id);
  });
});

describe('per-user message rate limiting', () => {
  it('returns 429 after 5 messages in the same channel within 30 seconds', async () => {
    const { owner, channel } = await createFixture();

    // Send 5 messages — all should succeed
    for (let i = 0; i < 5; i++) {
      const res = await harness.request.post<MessageRow>(`/channels/${channel.id}/messages`, {
        headers: harness.headers.forUser(owner.id),
        json: { content: `msg ${i}` },
      });
      expect(res.status).toBe(201);
    }

    // 6th message should be rate-limited
    const limited = await harness.request.post<{ error: string }>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'one too many' },
    });

    expect(limited.status).toBe(429);
    expect(limited.body?.error).toMatch(/Rate limit exceeded/);
    expect(limited.body?.error).toMatch(/5 messages per 30 seconds/);
    expect(limited.headers?.get('retry-after')).toBeTruthy();
  });

  it('rate limits are per-user — different users have separate limits', async () => {
    const { owner, member, channel } = await createFixture();

    // Owner sends 5 messages
    for (let i = 0; i < 5; i++) {
      await harness.request.post(`/channels/${channel.id}/messages`, {
        headers: harness.headers.forUser(owner.id),
        json: { content: `owner msg ${i}` },
      });
    }

    // Member can still send (separate limit)
    const memberMsg = await harness.request.post<MessageRow>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(member.id),
      json: { content: 'member msg' },
    });
    expect(memberMsg.status).toBe(201);
  });

  it('rate limits are per-channel — same user can post in different channels', async () => {
    const { owner, channel } = await createFixture();
    const channel2 = await harness.factories.createChannel({
      name: 'other',
      slug: 'other',
      channelType: 'public',
      createdBy: owner.id,
    });

    // Owner hits limit in channel 1
    for (let i = 0; i < 5; i++) {
      await harness.request.post(`/channels/${channel.id}/messages`, {
        headers: harness.headers.forUser(owner.id),
        json: { content: `ch1 msg ${i}` },
      });
    }

    // Same owner can still post in channel 2
    const ch2Msg = await harness.request.post<MessageRow>(`/channels/${channel2.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'ch2 msg' },
    });
    expect(ch2Msg.status).toBe(201);
  });

  it('rate limit check happens after error filter but before dedupe', async () => {
    const { owner, channel } = await createFixture();

    // Error filter should still reject API errors even without hitting rate limit
    const apiError = await harness.request.post<{ error: string }>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'LLM error api_error: Internal server error' },
    });
    expect(apiError.status).toBe(422);

    // Fill up rate limit
    for (let i = 0; i < 5; i++) {
      await harness.request.post(`/channels/${channel.id}/messages`, {
        headers: harness.headers.forUser(owner.id),
        json: { content: `fill ${i}` },
      });
    }

    // Rate-limited request should get 429, not a dedupe 409
    const rateLimited = await harness.request.post<{ error: string }>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'fill 0' },
    });
    expect(rateLimited.status).toBe(429);
  });
});

describe('resolveChannel lookup', () => {
  it('resolves channel by slug', async () => {
    const owner = await harness.factories.createUser({ email: 'ws-owner@example.com', displayName: 'WS Owner' });

    await harness.factories.createChannel({
      name: 'lookup-test',
      slug: 'lookup-test',
      createdBy: owner.id,
    });

    const res = await harness.request.get<MessageRow[]>(`/channels/lookup-test/messages`, {
      headers: harness.headers.forUser(owner.id),
    });
    expect(res.status).toBe(200);
  });

  it('UUID-based lookup works', async () => {
    const { owner, channel } = await createFixture();

    const res = await harness.request.get<MessageRow[]>(`/channels/${channel.id}/messages`, {
      headers: harness.headers.forUser(owner.id),
    });
    expect(res.status).toBe(200);
  });
});
});
