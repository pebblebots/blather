/**
 * Reconcile a Drizzle migration ledger after schema changes were applied by a
 * legacy/manual process. This does not inspect or modify application tables.
 * Operators must verify the live schema first and explicitly pass --apply.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

const args = process.argv.slice(2);
const throughIndex = args.indexOf('--through');
const through = throughIndex >= 0 ? args[throughIndex + 1] : undefined;
const apply = args.includes('--apply');

if (!through) {
  throw new Error('Usage: pnpm run migrate:baseline -- --through <migration-tag> [--apply]');
}

const migrationsDir = resolve(process.cwd(), 'drizzle');
const journal = JSON.parse(
  await readFile(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };
const target = journal.entries.find((entry) => entry.tag === through);
if (!target) throw new Error(`Unknown migration tag: ${through}`);

const candidates = await Promise.all(
  journal.entries.slice(0, target.idx + 1).map(async (entry) => {
    const contents = await readFile(resolve(migrationsDir, `${entry.tag}.sql`));
    return {
      ...entry,
      hash: createHash('sha256').update(contents).digest('hex'),
    };
  }),
);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const db = postgres(connectionString, { max: 1 });

try {
  const applied = await db<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at
  `;
  const hashes = new Set(applied.map((entry) => entry.hash));
  const maxCreatedAt = applied.reduce(
    (max, entry) => BigInt(entry.created_at) > max ? BigInt(entry.created_at) : max,
    0n,
  );
  const missing = candidates.filter(
    (entry) => BigInt(entry.when) > maxCreatedAt && !hashes.has(entry.hash),
  );

  if (missing.length === 0) {
    console.log(`[baseline] No missing ledger entries through ${through}.`);
    process.exitCode = 0;
  } else {
    console.log(`[baseline] Missing through ${through}:`);
    for (const entry of missing) console.log(`  ${entry.tag} ${entry.hash.slice(0, 12)}`);

    if (!apply) {
      console.log('[baseline] Dry run only. Re-run with --apply after verifying the live schema.');
    } else {
      await db.begin(async (tx) => {
        for (const entry of missing) {
          await tx.unsafe(
            `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            SELECT $1, $2
            WHERE NOT EXISTS (
              SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1
            )`,
            [entry.hash, entry.when],
          );
        }
      });
      console.log(`[baseline] Recorded ${missing.length} verified historical migrations.`);
    }
  }
} finally {
  await db.end();
}
