import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  channelMembers,
  channelReads,
  channels,
  messages,
  workspaceMembers,
} from '@blather/db';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

type Workspace = {
  id: string;
  name: string;
  slug: string;
};

type Channel = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  channelType: 'public' | 'private' | 'dm';
  isDefault: boolean;
  topic: string | null;
  createdBy: string | null;
  archived: boolean;
};

describe('workspace routes', () => {
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

  it('GET /workspaces lists only workspaces where the current user is a member', async () => {
    const user = await harness.factories.createUser();
    const otherUser = await harness.factories.createUser();

    const memberWorkspace = await harness.factories.createWorkspace({ ownerId: user.id });
    await harness.factories.createWorkspace({ ownerId: otherUser.id });

    const response = await harness.request.get<Workspace[]>('/workspaces', {
      headers: harness.headers.forUser(user.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body?.[0]).toMatchObject({
      id: memberWorkspace.id,
      name: memberWorkspace.name,
      slug: memberWorkspace.slug,
    });
  });

  it('POST /workspaces creates the workspace, owner membership, and default general channel', async () => {
    const user = await harness.factories.createUser();

    const response = await harness.request.post<Workspace>('/workspaces', {
      headers: harness.headers.forUser(user.id),
      json: {
        name: 'Acme Workspace',
        slug: 'acme-workspace',
      },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'Acme Workspace',
      slug: 'acme-workspace',
    });

    const workspaceId = response.body!.id;

    const [membership] = await harness.db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)));

    expect(membership?.role).toBe('owner');

    const [general] = await harness.db
      .select()
      .from(channels)
      .where(and(eq(channels.workspaceId, workspaceId), eq(channels.slug, 'general')));

    expect(general).toBeDefined();
    expect(general?.isDefault).toBe(true);
    expect(general?.channelType).toBe('public');

    const [generalMembership] = await harness.db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, general!.id), eq(channelMembers.userId, user.id)));

    expect(generalMembership).toBeDefined();
  });

  it('GET /workspaces/:id/channels includes public channels and only private/DM channels the user belongs to', async () => {
    const user = await harness.factories.createUser();
    const otherUser = await harness.factories.createUser();
    const workspace = await harness.factories.createWorkspace({ ownerId: user.id });

    const publicChannel = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: 'public-room',
      slug: 'public-room',
      channelType: 'public',
      createdBy: user.id,
    });

    const privateMemberChannel = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: 'private-member',
      slug: 'private-member',
      channelType: 'private',
      createdBy: otherUser.id,
    });

    const privateOtherChannel = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: 'private-other',
      slug: 'private-other',
      channelType: 'private',
      createdBy: otherUser.id,
    });

    const dmMemberChannel = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: '',
      slug: `dm-${user.id}-${otherUser.id}`,
      channelType: 'dm',
      createdBy: otherUser.id,
    });

    const dmOtherChannel = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: '',
      slug: 'dm-unrelated-users',
      channelType: 'dm',
      createdBy: otherUser.id,
    });

    await harness.db.insert(channelMembers).values({
      channelId: privateMemberChannel.id,
      userId: user.id,
    });
    await harness.db.insert(channelMembers).values({
      channelId: dmMemberChannel.id,
      userId: user.id,
    });

    const response = await harness.request.get<Channel[]>(`/workspaces/${workspace.id}/channels`, {
      headers: harness.headers.forUser(user.id),
    });

    expect(response.status).toBe(200);

    const channelIds = new Set(response.body?.map((channel) => channel.id));
    expect(channelIds.has(publicChannel.id)).toBe(true);
    expect(channelIds.has(privateMemberChannel.id)).toBe(true);
    expect(channelIds.has(dmMemberChannel.id)).toBe(true);

    expect(channelIds.has(privateOtherChannel.id)).toBe(false);
    expect(channelIds.has(dmOtherChannel.id)).toBe(false);
  });

  it('POST /workspaces/:id/channels creates a channel and auto-adds the creator as member', async () => {
    const user = await harness.factories.createUser();
    const workspace = await harness.factories.createWorkspace({ ownerId: user.id });

    const response = await harness.request.post<Channel>(`/workspaces/${workspace.id}/channels`, {
      headers: harness.headers.forUser(user.id),
      json: {
        name: 'eng-private',
        slug: 'eng-private',
        channelType: 'private',
        topic: 'Engineering discussion',
      },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      workspaceId: workspace.id,
      name: 'eng-private',
      slug: 'eng-private',
      channelType: 'private',
      topic: 'Engineering discussion',
      createdBy: user.id,
    });

    const [creatorMembership] = await harness.db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, response.body!.id), eq(channelMembers.userId, user.id)));

    expect(creatorMembership).toBeDefined();
  });

  it('GET /workspaces/:id/members returns all users in the workspace', async () => {
    const owner = await harness.factories.createUser({ email: 'owner@example.com', displayName: 'Owner' });
    const member = await harness.factories.createUser({ email: 'member@example.com', displayName: 'Member' });
    const workspace = await harness.factories.createWorkspace({ ownerId: owner.id });

    await harness.db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: member.id,
      role: 'member',
    });

    const response = await harness.request.get<Array<{ id: string; email: string; displayName: string }>>(
      `/workspaces/${workspace.id}/members`,
      { headers: harness.headers.forUser(owner.id) },
    );

    expect(response.status).toBe(200);

    const emails = new Set(response.body?.map((u) => u.email));
    expect(emails.has('owner@example.com')).toBe(true);
    expect(emails.has('member@example.com')).toBe(true);
  });

  it('POST /workspaces/:id/dm is idempotent and returns the same DM channel for the same pair of users', async () => {
    const user = await harness.factories.createUser();
    const peer = await harness.factories.createUser();
    const workspace = await harness.factories.createWorkspace({ ownerId: user.id });

    await harness.db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: peer.id,
      role: 'member',
    });

    const firstResponse = await harness.request.post<Channel>(`/workspaces/${workspace.id}/dm`, {
      headers: harness.headers.forUser(user.id),
      json: { userId: peer.id },
    });

    const secondResponse = await harness.request.post<Channel>(`/workspaces/${workspace.id}/dm`, {
      headers: harness.headers.forUser(user.id),
      json: { userId: peer.id },
    });

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(200);
    expect(firstResponse.body?.id).toBe(secondResponse.body?.id);

    const dmRows = await harness.db
      .select()
      .from(channels)
      .where(and(eq(channels.workspaceId, workspace.id), eq(channels.channelType, 'dm')));

    expect(dmRows).toHaveLength(1);

    const members = await harness.db
      .select()
      .from(channelMembers)
      .where(eq(channelMembers.channelId, dmRows[0]!.id));

    const memberIds = new Set(members.map((m) => m.userId));
    expect(memberIds.has(user.id)).toBe(true);
    expect(memberIds.has(peer.id)).toBe(true);
  });

  it('GET /workspaces/:id/unread returns unread counts by channel for the current user', async () => {
    const user = await harness.factories.createUser();
    const workspace = await harness.factories.createWorkspace({ ownerId: user.id });

    const unreadChannel = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: 'unread',
      slug: 'unread',
      channelType: 'public',
      createdBy: user.id,
    });

    const readChannel = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: 'read',
      slug: 'read',
      channelType: 'public',
      createdBy: user.id,
    });

    await harness.factories.createMessage({
      channelId: unreadChannel.id,
      userId: user.id,
      content: 'new unread message',
    });

    await harness.factories.createMessage({
      channelId: readChannel.id,
      userId: user.id,
      content: 'already read message',
    });

    const [readMessage] = await harness.db
      .select()
      .from(messages)
      .where(eq(messages.channelId, readChannel.id))
      .limit(1);

    await harness.db.insert(channelReads).values({
      channelId: readChannel.id,
      userId: user.id,
      lastReadAt: new Date(readMessage!.createdAt.getTime() + 60_000),
    });

    const response = await harness.request.get<Record<string, number>>(`/workspaces/${workspace.id}/unread`, {
      headers: harness.headers.forUser(user.id),
    });

    expect(response.status).toBe(200);
    expect(response.body?.[unreadChannel.id]).toBe(1);
    expect(response.body?.[readChannel.id]).toBeUndefined();
  });

  it('GET /workspaces/:id/presence returns workspace presence payload', async () => {
    const user = await harness.factories.createUser();
    const workspace = await harness.factories.createWorkspace({ ownerId: user.id });

    const response = await harness.request.get<Array<{ userId: string; status: string }>>(
      `/workspaces/${workspace.id}/presence`,
      { headers: harness.headers.forUser(user.id) },
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toEqual([]);
  });

  it('GET /workspaces returns empty array when user is not a member of any workspace', async () => {
    const user = await harness.factories.createUser();
    const otherUser = await harness.factories.createUser();

    // A workspace exists, but our user is not a member
    await harness.factories.createWorkspace({ ownerId: otherUser.id });

    const response = await harness.request.get('/workspaces', {
      headers: harness.headers.forUser(user.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
