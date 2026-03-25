import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import {
  channelMembers,
  channels,
  messages,
  users,
  workspaceMembers,
  workspaces,
} from '@blather/db';
import * as schema from '@blather/db';

const DEFAULT_TEST_DATABASE_URL = 'postgresql://blather:blather@127.0.0.1:5432/blather_test';
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));

const migratedDatabases = new Set<string>();

type Db = PostgresJsDatabase<typeof schema>;

type CreateTestDatabaseOptions = {
  databaseUrl?: string;
  runMigrations?: boolean;
};

type CreateUserInput = {
  email?: string;
  passwordHash?: string | null;
  displayName?: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  voice?: string | null;
  bio?: string | null;
};

type CreateWorkspaceInput = {
  name?: string;
  slug?: string;
  allowedDomains?: string[];
  ownerId?: string;
};

type CreateChannelInput = {
  workspaceId: string;
  name?: string;
  slug?: string;
  channelType?: 'public' | 'private' | 'dm';
  isDefault?: boolean;
  topic?: string | null;
  createdBy?: string | null;
};

type CreateMessageInput = {
  channelId: string;
  userId?: string | null;
  content?: string;
  threadId?: string | null;
  attachments?: { url: string; filename: string; contentType: string; size: number }[];
};

export type TestFactories = {
  createUser(input?: CreateUserInput): Promise<typeof users.$inferSelect>;
  createWorkspace(input?: CreateWorkspaceInput): Promise<typeof workspaces.$inferSelect>;
  createChannel(input: CreateChannelInput): Promise<typeof channels.$inferSelect>;
  createMessage(input: CreateMessageInput): Promise<typeof messages.$inferSelect>;
};

export type TestDatabase = {
  databaseUrl: string;
  sql: Sql;
  db: Db;
  factories: TestFactories;
  reset(): Promise<void>;
  close(): Promise<void>;
};

function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

function resolveDatabaseUrl(databaseUrl?: string): string {
  return databaseUrl ?? process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

async function truncateAllTables(sql: Sql): Promise<void> {
  const tableNames = [
    'agent_activity_log',
    'task_comments',
    'portfolio_metrics',
    'huddle_participants',
    'huddles',
    'incidents',
    'tasks',
    'channel_reads',
    'events',
    'reactions',
    'messages',
    'channel_members',
    'channels',
    'workspace_members',
    'workspaces',
    'api_keys',
    'magic_tokens',
    'users',
  ];

  const quotedTables = tableNames.map((name) => `"${name}"`).join(', ');
  await sql.unsafe(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
}

function createTestFactories(db: Db): TestFactories {
  return {
    async createUser(input = {}) {
      const suffix = uniqueSuffix();
      const [user] = await db
        .insert(users)
        .values({
          email: input.email ?? `test-user-${suffix}@example.com`,
          passwordHash: input.passwordHash ?? null,
          displayName: input.displayName ?? `Test User ${suffix}`,
          avatarUrl: input.avatarUrl ?? null,
          isAgent: input.isAgent ?? false,
          voice: input.voice ?? null,
          bio: input.bio ?? null,
        })
        .returning();
      return user;
    },

    async createWorkspace(input = {}) {
      const suffix = uniqueSuffix();
      const [workspace] = await db
        .insert(workspaces)
        .values({
          name: input.name ?? `Test Workspace ${suffix}`,
          slug: input.slug ?? `test-workspace-${suffix}`,
          allowedDomains: input.allowedDomains ?? [],
        })
        .returning();

      if (input.ownerId) {
        await db.insert(workspaceMembers).values({
          workspaceId: workspace.id,
          userId: input.ownerId,
          role: 'owner',
        });
      }

      return workspace;
    },

    async createChannel(input) {
      const suffix = uniqueSuffix();
      const [channel] = await db
        .insert(channels)
        .values({
          workspaceId: input.workspaceId,
          name: input.name ?? `test-channel-${suffix}`,
          slug: input.slug ?? `test-channel-${suffix}`,
          channelType: input.channelType ?? 'public',
          isDefault: input.isDefault ?? false,
          topic: input.topic ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning();

      if (input.createdBy) {
        await db.insert(channelMembers).values({
          channelId: channel.id,
          userId: input.createdBy,
        });
      }

      return channel;
    },

    async createMessage(input) {
      const [message] = await db
        .insert(messages)
        .values({
          channelId: input.channelId,
          userId: input.userId ?? null,
          content: input.content ?? 'Test message',
          threadId: input.threadId ?? null,
          attachments: input.attachments ?? [],
        })
        .returning();
      return message;
    },
  };
}

export async function createTestDatabase(options: CreateTestDatabaseOptions = {}): Promise<TestDatabase> {
  const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql, { schema });

  if (options.runMigrations !== false && !migratedDatabases.has(databaseUrl)) {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    migratedDatabases.add(databaseUrl);
  }

  await truncateAllTables(sql);

  return {
    databaseUrl,
    sql,
    db,
    factories: createTestFactories(db),
    reset: async () => {
      await truncateAllTables(sql);
    },
    close: async () => {
      await sql.end();
    },
  };
}
