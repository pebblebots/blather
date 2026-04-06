import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import {
  channelMembers,
  channels,
  messages,
  users,
} from '@blather/db';
import * as schema from '@blather/db';
import { clearTaskDbForTesting } from '../tasks/db.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../db/drizzle', import.meta.url));
const TEST_DATABASE_LABEL = 'pglite://memory';

type Db = PgliteDatabase<typeof schema>;

type CreateTestDatabaseOptions = {
  dataDir?: string;
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

type CreateChannelInput = {
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
  canvas?: { html: string; title?: string; width?: number; height?: number } | null;
};

export type TestFactories = {
  createUser(input?: CreateUserInput): Promise<typeof users.$inferSelect>;
  createChannel(input?: CreateChannelInput): Promise<typeof channels.$inferSelect>;
  createMessage(input: CreateMessageInput): Promise<typeof messages.$inferSelect>;
};

export type TestDatabase = {
  databaseUrl: string;
  sql: PGlite;
  db: Db;
  factories: TestFactories;
  reset(): Promise<void>;
  close(): Promise<void>;
};

function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

async function truncateAllTables(sql: PGlite): Promise<void> {
  const tableNames = [
    'agent_activity_log',
    'portfolio_metrics',
    'huddle_participants',
    'huddles',
    'incidents',
    'channel_reads',
    'events',
    'reactions',
    'messages',
    'channel_members',
    'channels',
    'api_keys',
    'magic_tokens',
    'users',
  ];

  const quotedTables = tableNames.map((name) => `"${name}"`).join(', ');
  await sql.exec(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
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

    async createChannel(input = {}) {
      const suffix = uniqueSuffix();
      const [channel] = await db
        .insert(channels)
        .values({
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
          canvas: input.canvas ? { ...input.canvas, version: 1 } : null,
        })
        .returning();
      return message;
    },
  };
}

export async function createTestDatabase(options: CreateTestDatabaseOptions = {}): Promise<TestDatabase> {
  const sql = new PGlite(options.dataDir);
  const db = drizzle(sql, { schema });

  if (options.runMigrations !== false) {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  await truncateAllTables(sql);

  return {
    databaseUrl: TEST_DATABASE_LABEL,
    sql,
    db,
    factories: createTestFactories(db),
    reset: async () => {
      await truncateAllTables(sql);
      clearTaskDbForTesting();
    },
    close: async () => {
      await sql.close();
    },
  };
}
