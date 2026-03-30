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

    const general = await harness.factories.createChannel({
      name: 'general',
      slug: 'general',
      channelType: 'public',
      createdBy: requester.id,
    });

    const random = await harness.factories.createChannel({
      name: 'random',
      slug: 'random',
      channelType: 'public',
      createdBy: requester.id,
    });

    return { requester, teammate, general, random };
  }

  it('GET /messages/search finds messages by keyword', async () => {
    const { requester, general } = await createFixture();

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
    const { requester, general, random } = await createFixture();

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
    const { requester, teammate, general } = await createFixture();

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

  it('GET /messages/search returns 400 when required params are missing', async () => {
    const { requester } = await createFixture();
    const headers = harness.headers.forUser(requester.id);

    // Missing q
    const noParams = await harness.request.get('/messages/search', { headers });
    expect(noParams.status).toBe(400);
  });

  it('GET /messages/search excludes messages from private channels the user is not a member of', async () => {
    const { requester, teammate } = await createFixture();

    // Create a private channel that only teammate is a member of
    const secret = await harness.factories.createChannel({
      name: 'secret',
      slug: 'secret',
      channelType: 'private',
      createdBy: teammate.id,
    });
    // createChannel auto-adds createdBy as a member

    // Teammate posts a matching message in the private channel
    await harness.factories.createMessage({
      channelId: secret.id,
      userId: teammate.id,
      content: 'classified budget projections',
    });

    // Requester (non-member) searches for it — should not find it
    const response = await harness.request.get<SearchResult[]>('/messages/search', {
      headers: harness.headers.forUser(requester.id),
      query: { q: 'classified' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('GET /messages/search returns an empty array when no messages match', async () => {
    const { requester, general } = await createFixture();

    await harness.factories.createMessage({
      channelId: general.id,
      userId: requester.id,
      content: 'ship the hotfix tonight',
    });

    const response = await harness.request.get<SearchResult[]>('/messages/search', {
      headers: harness.headers.forUser(requester.id),
      query: {
        q: 'nonexistent-keyword',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
