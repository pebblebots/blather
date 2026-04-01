import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url?: string) {
  const connectionString = url || process.env.DATABASE_URL || 'postgresql://blather:blather-dev@localhost:5432/blather';
  const client = postgres(connectionString, { max: 30 });
  return drizzle(client, { schema });
}

export * from './schema.js';
export * from './signals-schema.js';
export type Db = PgDatabase<any, typeof schema>;
