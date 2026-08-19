import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

describe('deal routes', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => harness.reset());
  afterAll(async () => harness.close());

  async function owner() {
    return harness.factories.createUser({ email: 'owner@example.com', displayName: 'Owner' });
  }

  it('creates, lists, filters, and resolves a deal by short ID', async () => {
    const user = await owner();
    const headers = harness.headers.forUser(user.id);
    const created = await harness.request.post<any>('/deals', {
      headers,
      json: { name: 'Acme', company: 'Acme Inc', stage: 'dd', status: 'watchlist' },
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Acme', stage: 'dd', status: 'watchlist', archived: false });
    expect(created.body.shortId).toBeTypeOf('number');

    const list = await harness.request.get<any[]>('/deals', { headers, query: { stage: 'dd' } });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const resolved = await harness.request.get<any>(`/deals/D%23${created.body.shortId}`, { headers });
    expect(resolved.status).toBe(200);
    expect(resolved.body.id).toBe(created.body.id);
  });

  it('updates a deal and records change history transactionally', async () => {
    const user = await owner();
    const headers = harness.headers.forUser(user.id);
    const created = await harness.request.post<any>('/deals', { headers, json: { name: 'Acme' } });

    const updated = await harness.request.patch<any>(`/deals/${created.body.id}`, {
      headers,
      json: { stage: 'move', notes: 'Partner meeting complete' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ stage: 'move', notes: 'Partner meeting complete' });

    const changes = await harness.request.get<any[]>(`/deals/${created.body.id}/changes`, { headers });
    expect(changes.status).toBe(200);
    expect(changes.body?.some((change) => change.field === 'stage' && change.new_value === 'move')).toBe(true);
    expect(changes.body?.some((change) => change.field === 'notes' && change.new_value === 'Partner meeting complete')).toBe(true);
  });

  it('hides archived deals by default and includes them on request', async () => {
    const user = await owner();
    const headers = harness.headers.forUser(user.id);
    await harness.request.post('/deals', { headers, json: { name: 'Archived', archived: true } });

    const normal = await harness.request.get<any[]>('/deals', { headers });
    expect(normal.body).toHaveLength(0);
    const all = await harness.request.get<any[]>('/deals', { headers, query: { includeArchived: true } });
    expect(all.body).toHaveLength(1);
    expect(all.body?.[0].archived).toBe(true);
  });

  it('deletes a deal while retaining its deletion audit records', async () => {
    const user = await owner();
    const headers = harness.headers.forUser(user.id);
    const created = await harness.request.post<any>('/deals', { headers, json: { name: 'Delete me' } });
    const deleted = await harness.request.delete(`/deals/${created.body.id}`, { headers });
    expect(deleted.status).toBe(200);

    const audit = await testDatabase.sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM deal_changes WHERE deal_id = '${created.body.id}' AND change_type = 'delete'`,
    );
    expect(audit.rows[0]?.count).toBeGreaterThan(0);
  });
});
