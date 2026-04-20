/**
 * One-shot backfill: ensure channel_members rows exist for every (user, channel)
 * pair that has posted in the last 7 days.
 *
 * Context (T#158): T#151 extends the channel-membership ACL to public channels.
 * Before the new code deploys, any agent or human that has been posting to a
 * public channel without an explicit channel_members row will start getting
 * 403s. This script pre-populates those rows so the deploy is a no-op for
 * everyone who is actively using each channel.
 *
 * Run BEFORE deploying the T#151 API:
 *   npx tsx packages/api/scripts/backfill-channel-members.ts
 *
 * Idempotent: uses ON CONFLICT DO NOTHING. Safe to run multiple times.
 * Prints a per-channel summary of how many rows were inserted.
 */

import { sql } from 'drizzle-orm';
import { createDb } from '@blather/db';

type PairRow = { userId: string; channelId: string; messageCount: number };
type SummaryRow = { channelId: string; channelName: string | null; inserted: number };

async function main() {
  const db = createDb();

  console.log('[backfill] Pulling last-7-days (userId, channelId) pairs from messages...');

  const pairsResult = await db.execute(sql`
    SELECT user_id AS "userId",
           channel_id AS "channelId",
           COUNT(*)::int AS "messageCount"
    FROM messages
    WHERE user_id IS NOT NULL
      AND created_at > NOW() - INTERVAL '7 days'
    GROUP BY user_id, channel_id
    ORDER BY channel_id, "messageCount" DESC
  `);

  const pairs: PairRow[] = ((pairsResult as any).rows ?? (pairsResult as any)) as PairRow[];
  console.log(`[backfill] Found ${pairs.length} distinct (user, channel) pairs to check.`);

  // Insert missing rows, counting inserts per channel.
  const perChannel = new Map<string, number>();

  for (const { userId, channelId } of pairs) {
    const res = await db.execute(sql`
      INSERT INTO channel_members (channel_id, user_id)
      VALUES (${channelId}, ${userId})
      ON CONFLICT (channel_id, user_id) DO NOTHING
      RETURNING channel_id
    `);

    const inserted = ((res as any).rowCount ?? ((res as any).rows?.length ?? 0)) as number;
    if (inserted > 0) {
      perChannel.set(channelId, (perChannel.get(channelId) ?? 0) + inserted);
    }
  }

  // Look up channel names for a nicer report.
  const channelIds = [...perChannel.keys()];
  const summary: SummaryRow[] = [];

  if (channelIds.length > 0) {
    const nameRes = await db.execute(sql`
      SELECT id AS "channelId", name AS "channelName"
      FROM channels
      WHERE id = ANY(${channelIds})
    `);
    const nameRows: { channelId: string; channelName: string | null }[] =
      ((nameRes as any).rows ?? (nameRes as any)) as any[];
    const nameById = new Map(nameRows.map((r) => [r.channelId, r.channelName]));

    for (const [channelId, inserted] of perChannel) {
      summary.push({ channelId, channelName: nameById.get(channelId) ?? null, inserted });
    }
    summary.sort((a, b) => b.inserted - a.inserted);
  }

  const totalInserted = summary.reduce((sum, r) => sum + r.inserted, 0);

  console.log('');
  console.log('[backfill] === Summary ===');
  console.log(`[backfill] Channels touched: ${summary.length}`);
  console.log(`[backfill] Rows inserted:   ${totalInserted}`);
  console.log(`[backfill] Pairs unchanged: ${pairs.length - totalInserted} (already had membership)`);
  console.log('');

  if (summary.length > 0) {
    console.log('[backfill] Per-channel breakdown:');
    for (const row of summary) {
      const label = row.channelName ? `#${row.channelName}` : row.channelId;
      console.log(`  ${row.inserted.toString().padStart(5, ' ')}  ${label}  (${row.channelId})`);
    }
  }

  console.log('');
  console.log('[backfill] Done.');
}

main().catch((err) => {
  console.error('[backfill] FAILED:', err);
  process.exit(1);
});
