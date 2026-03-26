import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

type SearchResult = {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
  userName: string;
  userIsAgent: boolean;
  channelName: string;
  channelSlug: string;
  channelType: 'public' | 'private' | 'dm';
};

describe('message routes', () => {
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
    const requester = await harness.factories.createUser({ email: 'requester@example.com', displayName: 'Requester' });
    const teammate = await harness.factories.createUser({ email: 'teammate@example.com', displayName: 'Teammate' });
    const workspace = await harness.factories.createWorkspace({ ownerId: requester.id });

    const general = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: 'general',
      slug: 'general',
      channelType: 'public',
      createdBy: requester.id,
    });

    const random = await harness.factories.createChannel({
      workspaceId: workspace.id,
      name: 'random',
      slug: 'random',
      channelType: 'public',
      createdBy: requester.id,
    });

    return { requester, teammate, workspace, general, random };
  }

  it('GET /messages/search finds messages by keyword', async () => {
    const { requester, workspace, general } = await createFixture();

    const match = await harness.factories.createMessage({
      channelId: general.id,
      userId: requester.id,
      content: 'release checklist is ready',
    });
    await harness.factories.createMessage({
      channelId: general.id,
      userId: requester.id,
      content: 'totally unrelated update',
    });

    const response = await harness.request.get<SearchResult[]>('/messages/search', {
      headers: harness.headers.forUser(requester.id),
      query: {
        workspaceId: workspace.id,
        q: 'checklist',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body?.[0]).toMatchObject({
      id: match.id,
      channelId: general.id,
      content: 'release checklist is ready',
      userId: requester.id,
      userName: 'Requester',
      channelSlug: 'general',
    });
  });

  it('GET /messages/search filters by channelId', async () => {
    const { requester, workspace, general, random } = await createFixture();

    const inGeneral = await harness.factories.createMessage({
      channelId: general.id,
      userId: requester.id,
      content: 'incident alpha report',
    });
    await harness.factories.createMessage({
      channelId: random.id,
      userId: requester.id,
      content: 'incident alpha report',
    });

    const response = await harness.request.get<SearchResult[]>('/messages/search', {
      headers: harness.headers.forUser(requester.id),
      query: {
        workspaceId: workspace.id,
        q: 'incident alpha',
        channelId: general.id,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body?.[0]?.id).toBe(inGeneral.id);
    expect(response.body?.[0]?.channelId).toBe(general.id);
  });

  it('GET /messages/search filters by userId', async () => {
    const { requester, teammate, workspace, general } = await createFixture();

    await harness.factories.createMessage({
      channelId: general.id,
      userId: requester.id,
      content: 'deployment is complete',
    });
    const byTeammate = await harness.factories.createMessage({
      channelId: general.id,
      userId: teammate.id,
      content: 'deployment is complete',
    });

    const response = await harness.request.get<SearchResult[]>('/messages/search', {
      headers: harness.headers.forUser(requester.id),
      query: {
        workspaceId: workspace.id,
        q: 'deployment',
        userId: teammate.id,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body?.[0]).toMatchObject({
      id: byTeammate.id,
      userId: teammate.id,
      userName: 'Teammate',
    });
  });

  it('GET /messages/search returns an empty array when no messages match', async () => {
    const { requester, workspace, general } = await createFixture();

    await harness.factories.createMessage({
      channelId: general.id,
      userId: requester.id,
      content: 'ship the hotfix tonight',
    });

    const response = await harness.request.get<SearchResult[]>('/messages/search', {
      headers: harness.headers.forUser(requester.id),
      query: {
        workspaceId: workspace.id,
        q: 'nonexistent-keyword',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
