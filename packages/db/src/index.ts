import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url?: string) {
  const connectionString = url || process.env.DATABASE_URL || 'postgresql://blather:blather-dev@localhost:5432/blather';
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export * from './schema.js';
export type Db = ReturnType<typeof createDb>;
