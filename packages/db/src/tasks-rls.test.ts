import { randomUUID } from 'node:crypto';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
const liveRlsTests = Boolean(databaseUrl);
type Row = Record<string, any>;
type Client = Sql | TransactionSql;

async function query<T extends Row>(client: Client, text: string, values: unknown[] = []): Promise<T[]> {
  return client.unsafe<T[]>(text, values as any[]) as unknown as T[];
}

describe.skipIf(!liveRlsTests)('tasks RLS policies', () => {
  let sql: Sql;

  beforeAll(() => {
    // CI runs the migration before the test suite. Keep this suite opt-in so
    // local unit tests do not require a running Postgres/Supabase instance.
    sql = postgres(databaseUrl!, { max: 1 });
  });

  beforeEach(async () => {
    await sql.unsafe('TRUNCATE TABLE task_comments, tasks, channel_members, channels, users CASCADE');
  });

  afterAll(async () => {
    await sql?.end({ timeout: 1 });
  });

  async function seed() {
    const viewerId = randomUUID();
    const outsiderId = randomUUID();
    const channelId = randomUUID();
    const otherChannelId = randomUUID();
    const visibleTaskId = randomUUID();
    const hiddenTaskId = randomUUID();
    const otherTaskId = randomUUID();

    await query(sql, `
      INSERT INTO users (id, email, display_name)
      VALUES ($1, $2, 'RLS viewer'), ($3, $4, 'RLS outsider')
    `, [viewerId, `${viewerId}@test.invalid`, outsiderId, `${outsiderId}@test.invalid`]);
    await query(sql, `
      INSERT INTO channels (id, name, slug, channel_type)
      VALUES ($1, 'RLS channel', $2, 'public'), ($3, 'Other channel', $4, 'public')
    `, [channelId, `rls-${channelId}`, otherChannelId, `rls-${otherChannelId}`]);
    await query(sql, `
      INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)
    `, [channelId, viewerId]);
    await query(sql, `
      INSERT INTO tasks (id, title, creator_id, source_channel_id)
      VALUES
        ($1, 'visible to channel participant', $2, $3),
        ($4, 'private to outsider', $2, NULL),
        ($5, 'outside channel', $2, $6)
    `, [visibleTaskId, outsiderId, channelId, hiddenTaskId, otherTaskId, otherChannelId]);

    return { viewerId, outsiderId, channelId, visibleTaskId, hiddenTaskId, otherTaskId };
  }

  async function asAuthenticated<T extends Row>(
    userId: string,
    fn: (tx: TransactionSql) => Promise<T[]>,
  ): Promise<T[]> {
    return sql.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE authenticated');
      await query(tx, `SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      await query(tx, `SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
      return fn(tx);
    }) as Promise<T[]>;
  }

  it('enables RLS without forcing it and installs the intended policies', async () => {
    const [table] = await query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql, `
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE oid = 'public.tasks'::regclass
    `);
    expect(table.relrowsecurity).toBe(true);
    expect(table.relforcerowsecurity).toBe(false);

    const policies = await query<{ policyname: string; cmd: string }>(sql, `
      SELECT policyname, cmd
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'tasks'
      ORDER BY policyname
    `);
    expect(policies).toEqual([
      { policyname: 'tasks_delete_authenticated_actor', cmd: 'DELETE' },
      { policyname: 'tasks_insert_authenticated_actor', cmd: 'INSERT' },
      { policyname: 'tasks_select_authenticated_relevant', cmd: 'SELECT' },
      { policyname: 'tasks_update_authenticated_actor', cmd: 'UPDATE' },
    ]);

    const updateColumns = await query<{ column_name: string }>(sql, `
      SELECT column_name
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = 'tasks'
        AND grantee = 'authenticated'
        AND privilege_type = 'UPDATE'
      ORDER BY column_name
    `);
    expect(updateColumns.map((row) => row.column_name)).not.toContain('claimed_by_id');
    expect(updateColumns.map((row) => row.column_name)).not.toContain('creator_id');
  });

  it('lets a channel participant read relevant tasks but not unrelated rows', async () => {
    const fixture = await seed();
    const rows = await asAuthenticated(fixture.viewerId, (tx) => query<{ id: string }>(tx,
      'SELECT id FROM tasks ORDER BY id',
    ));

    expect(rows.map((row) => row.id)).toEqual([fixture.visibleTaskId]);
  });

  it('allows an authenticated actor to create only self-attributed tasks in their channel', async () => {
    const fixture = await seed();

    const [created] = await asAuthenticated(fixture.viewerId, (tx) => query<{ id: string }>(tx, `
      INSERT INTO tasks (title, creator_id, source_channel_id)
      VALUES ('created by viewer', $1, $2)
      RETURNING id
    `, [fixture.viewerId, fixture.channelId]));
    expect(created.id).toBeTruthy();

    await expect(asAuthenticated(fixture.viewerId, (tx) => query(tx, `
      INSERT INTO tasks (title, creator_id)
      VALUES ('spoofed creator', $1)
    `, [fixture.outsiderId]))).rejects.toThrow();
  });

  it('allows only task actors to update or delete, while preserving the server path', async () => {
    const fixture = await seed();

    // Channel visibility does not grant mutation authority.
    const notUpdated = await asAuthenticated(fixture.viewerId, (tx) => query<{ id: string }>(tx, `
      UPDATE tasks SET title = 'must remain unchanged'
      WHERE id = $1
      RETURNING id
    `, [fixture.visibleTaskId]));
    expect(notUpdated).toHaveLength(0);

    // The task creator is an authorized actor.
    const [updated] = await asAuthenticated(fixture.outsiderId, (tx) => query<{ title: string }>(tx, `
      UPDATE tasks SET title = 'updated by creator'
      WHERE id = $1
      RETURNING title
    `, [fixture.visibleTaskId]));
    expect(updated.title).toBe('updated by creator');

    // The database owner is the existing server-side path and bypasses RLS.
    const [serverUpdated] = await query<{ title: string }>(sql, `
      UPDATE tasks SET title = 'updated by server'
      WHERE id = $1
      RETURNING title
    `, [fixture.hiddenTaskId]);
    expect(serverUpdated.title).toBe('updated by server');

    const notDeleted = await asAuthenticated(fixture.viewerId, (tx) => query<{ id: string }>(tx,
      'DELETE FROM tasks WHERE id = $1 RETURNING id',
      [fixture.otherTaskId],
    ));
    expect(notDeleted).toHaveLength(0);

    const [deleted] = await asAuthenticated(fixture.outsiderId, (tx) => query<{ id: string }>(tx,
      'DELETE FROM tasks WHERE id = $1 RETURNING id',
      [fixture.hiddenTaskId],
    ));
    expect(deleted.id).toBe(fixture.hiddenTaskId);
  });
});
