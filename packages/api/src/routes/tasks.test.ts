import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

describe('task routes', () => {
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

    return { owner, member };
  }

  // -- List tasks --

  it('GET /tasks lists tasks', async () => {
    const { owner } = await createFixture();

    await harness.request.post('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Task A' },
    });
    await harness.request.post('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Task B' },
    });

    const res = await harness.request.get<any[]>('/tasks', {
      headers: harness.headers.forUser(owner.id),
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /tasks filters by status', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Done task' },
    });
    await harness.request.patch(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'done' },
    });

    await harness.request.post('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Queued task' },
    });

    const res = await harness.request.get<any[]>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      query: { status: 'done' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].title).toBe('Done task');
  });

  it('GET /tasks filters by priority', async () => {
    const { owner } = await createFixture();

    await harness.request.post('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Urgent task', priority: 'urgent' },
    });
    await harness.request.post('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Low task', priority: 'low' },
    });

    const res = await harness.request.get<any[]>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      query: { priority: 'urgent' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].title).toBe('Urgent task');
  });

  it('GET /tasks filters by assigneeId', async () => {
    const { owner, member } = await createFixture();

    await harness.request.post('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Assigned task', assigneeId: member.id },
    });
    await harness.request.post('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Unassigned task' },
    });

    const res = await harness.request.get<any[]>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      query: { assigneeId: member.id },
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body![0].title).toBe('Assigned task');
  });

  // -- Create task --

  it('POST /tasks creates a task with defaults', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'New task' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'New task',
      priority: 'normal',
      status: 'queued',
      creatorId: owner.id,
      description: null,
      assigneeId: null,
    });
    expect(res.body.id).toBeDefined();
  });

  it('POST /tasks creates a task with all fields', async () => {
    const { owner, member } = await createFixture();

    const res = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: {
        title: 'Full task',
        description: 'Detailed description',
        priority: 'urgent',
        assigneeId: member.id,
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Full task',
      description: 'Detailed description',
      priority: 'urgent',
      assigneeId: member.id,
    });
  });

  it('POST /tasks returns 400 without title', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.post('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: {},
    });

    expect(res.status).toBe(400);
  });

  // -- Update task --

  it('PATCH /tasks/:id updates task fields', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Original' },
    });

    const res = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Updated', description: 'New desc', priority: 'low' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: createRes.body.id,
      title: 'Updated',
      description: 'New desc',
      priority: 'low',
    });
  });

  it('PATCH /tasks/:id updates status', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Status task' },
    });
    expect(createRes.body.status).toBe('queued');

    const res = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'in_progress' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');

    const res2 = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'done' },
    });

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('done');
  });

  it('PATCH /tasks/:id accepts hyphenated status (in-progress)', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Hyphen task' },
    });

    const res = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'in-progress' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  it('PATCH /tasks/:id returns 404 for nonexistent task', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.patch('/tasks/00000000-0000-0000-0000-000000000000', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Nope' },
    });

    expect(res.status).toBe(404);
  });

  // -- Delete task --

  it('DELETE /tasks/:id deletes a task', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'To delete' },
    });

    const res = await harness.request.delete(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    // Verify it's gone
    const listRes = await harness.request.get<any[]>('/tasks', {
      headers: harness.headers.forUser(owner.id),
    });
    expect(listRes.body).toHaveLength(0);
  });

  it('DELETE /tasks/:id returns 404 for nonexistent task', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.delete('/tasks/00000000-0000-0000-0000-000000000000', {
      headers: harness.headers.forUser(owner.id),
    });

    expect(res.status).toBe(404);
  });

  // -- Claim conflict --

  it('PATCH /tasks/:id returns 409 when task already claimed by another user', async () => {
    const { owner, member } = await createFixture();

    // Create a task
    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Contested task' },
    });

    // Owner claims it (sets to in_progress)
    const claimRes = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'in_progress' },
    });
    expect(claimRes.status).toBe(200);
    expect(claimRes.body.status).toBe('in_progress');
    expect(claimRes.body.claimedById).toBe(owner.id);

    // Member tries to claim it — should get 409
    const conflictRes = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(member.id),
      json: { status: 'in_progress' },
    });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error).toBe('Task already claimed');
    expect(conflictRes.body.claimedById).toBe(owner.id);
    expect(conflictRes.body.claimedByName).toBe('Owner');
  });

  it('PATCH /tasks/:id allows same user to re-claim their own task', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'My task' },
    });

    // Claim it
    await harness.request.patch(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'in_progress' },
    });

    // Same user re-claims — should succeed
    const res = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'in_progress' },
    });
    expect(res.status).toBe(200);
  });

  it('PATCH /tasks/:id clears claimedById when status goes to done', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Finish me' },
    });

    // Claim it
    await harness.request.patch(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'in_progress' },
    });

    // Mark done — claimedById should be cleared
    const doneRes = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'done' },
    });
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.claimedById).toBeNull();
  });

  it('PATCH /tasks/:id clears claimedById when status goes back to queued', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Requeue me' },
    });

    // Claim it
    await harness.request.patch(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'in_progress' },
    });

    // Back to queued — claimedById should be cleared, another user can claim
    const requeueRes = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'queued' },
    });
    expect(requeueRes.status).toBe(200);
    expect(requeueRes.body.claimedById).toBeNull();
  });

  // -- Completion Artifact Tests --

  it('PATCH /tasks/:id accepts and stores completionArtifact', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Artifact task' },
    });

    const res = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'done', completionArtifact: 'commit abc123' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completionArtifact).toBe('commit abc123');
  });

  it('GET /tasks includes completionArtifact field', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Artifact task' },
    });

    await harness.request.patch(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'done', completionArtifact: 'PR #42' },
    });

    const listRes = await harness.request.get<any[]>('/tasks', {
      headers: harness.headers.forUser(owner.id),
    });

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body![0].completionArtifact).toBe('PR #42');
  });

  it('PATCH /tasks/:id works without completionArtifact (backward compatible)', async () => {
    const { owner } = await createFixture();

    const createRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'No artifact task' },
    });

    const res = await harness.request.patch<any>(`/tasks/${createRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
      json: { status: 'done' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completionArtifact).toBeNull();
  });

  it('POST /tasks creates task with completionArtifact null by default', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'New task' },
    });

    expect(res.status).toBe(201);
    expect(res.body.completionArtifact).toBeNull();
  });

  // -- Task Comments --

  it('POST /tasks/:taskId/comments creates a comment', async () => {
    const { owner } = await createFixture();

    const taskRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Commentable' },
    });

    const res = await harness.request.post<any>(`/tasks/${taskRes.body.id}/comments`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'Great progress!' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      taskId: taskRes.body.id,
      userId: owner.id,
      content: 'Great progress!',
    });
  });

  it('POST /tasks/:taskId/comments returns 400 for empty content', async () => {
    const { owner } = await createFixture();

    const taskRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Commentable' },
    });

    const res = await harness.request.post(`/tasks/${taskRes.body.id}/comments`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: '   ' },
    });

    expect(res.status).toBe(400);
  });

  it('POST /tasks/:taskId/comments returns 404 for nonexistent task', async () => {
    const { owner } = await createFixture();

    const res = await harness.request.post('/tasks/00000000-0000-0000-0000-000000000000/comments', {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'Orphan comment' },
    });

    expect(res.status).toBe(404);
  });

  it('GET /tasks/:taskId/comments lists comments with user display name', async () => {
    const { owner, member } = await createFixture();

    const taskRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Multi-comment' },
    });

    await harness.request.post(`/tasks/${taskRes.body.id}/comments`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'First comment' },
    });
    await harness.request.post(`/tasks/${taskRes.body.id}/comments`, {
      headers: harness.headers.forUser(member.id),
      json: { content: 'Second comment' },
    });

    const res = await harness.request.get<any[]>(`/tasks/${taskRes.body.id}/comments`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body![0]).toMatchObject({ content: 'First comment', userDisplayName: 'Owner' });
    expect(res.body![1]).toMatchObject({ content: 'Second comment', userDisplayName: 'Member' });
  });

  it('DELETE /tasks/:taskId/comments/:commentId deletes own comment', async () => {
    const { owner } = await createFixture();

    const taskRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Delete comment test' },
    });

    const commentRes = await harness.request.post<any>(`/tasks/${taskRes.body.id}/comments`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'To delete' },
    });

    const res = await harness.request.delete(`/tasks/${taskRes.body.id}/comments/${commentRes.body.id}`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it('DELETE /tasks/:taskId/comments/:commentId returns 403 for non-author', async () => {
    const { owner, member } = await createFixture();

    const taskRes = await harness.request.post<any>('/tasks', {
      headers: harness.headers.forUser(owner.id),
      json: { title: 'Auth test' },
    });

    const commentRes = await harness.request.post<any>(`/tasks/${taskRes.body.id}/comments`, {
      headers: harness.headers.forUser(owner.id),
      json: { content: 'Owner comment' },
    });

    const res = await harness.request.delete(`/tasks/${taskRes.body.id}/comments/${commentRes.body.id}`, {
      headers: harness.headers.forUser(member.id),
    });

    expect(res.status).toBe(403);
  });
});
