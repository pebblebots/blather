import { eq, and, gte, lte } from 'drizzle-orm';
import { signalEntities, signalEvents, signalConvergences } from '@blather/db';
import type { Db } from '@blather/db';
import type { SignalEvent, WatchlistEntry } from '@blather/types';

// ── Normalization ──

const SUFFIX_RE = /\b(inc|corp|ltd|llc|ai|labs|co|plc)\.?\s*$/gi;

function normalize(name: string): string {
  return name.toLowerCase().replace(SUFFIX_RE, '').trim();
}

// ── Levenshtein ──

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Fuzzy matching ──

function fuzzyMatch(input: string, candidates: string[]): boolean {
  const norm = normalize(input);
  for (const c of candidates) {
    const nc = normalize(c);
    if (norm === nc) return true;
    if (levenshtein(norm, nc) <= 3) return true;
    if (norm.length >= 4 && nc.length >= 4) {
      if (norm.includes(nc) || nc.includes(norm)) return true;
    }
  }
  return false;
}

function lastNameMatch(personName: string, entityName: string): boolean {
  const parts = personName.trim().split(/\s+/);
  const eParts = entityName.trim().split(/\s+/);
  if (parts.length < 2 || eParts.length < 2) return false;
  return normalize(parts[parts.length - 1]) === normalize(eParts[eParts.length - 1]);
}

// ── Find matching entity ──

async function findEntity(db: Db, name: string, entityType?: string): Promise<{ id: string } | null> {
  const all = await db.select().from(signalEntities);
  for (const entity of all) {
    const allNames = [entity.name, ...(entity.aliases || [])];
    if (fuzzyMatch(name, allNames)) {
      return entity;
    }
    if (entityType === 'person' && entity.entityType === 'person') {
      if (lastNameMatch(name, entity.name)) return entity;
    }
  }
  return null;
}

// ── Public API ──

export async function ingestWatchlist(db: Db, jsonLines: string): Promise<{ upserted: number; skipped: number }> {
  const lines = jsonLines.trim().split('\n').filter(Boolean);
  let upserted = 0;
  let skipped = 0;

  for (const line of lines) {
    let entry: WatchlistEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }

    const existing = await findEntity(db, entry.name, entry.type);
    if (existing) {
      await db.update(signalEntities)
        .set({
          aliases: entry.aliases || [],
          metadata: entry.metadata || {},
          updatedAt: new Date(),
        })
        .where(eq(signalEntities.id, existing.id));
      upserted++;
    } else {
      await db.insert(signalEntities).values({
        entityType: entry.type,
        name: entry.name,
        aliases: entry.aliases || [],
        metadata: entry.metadata || {},
      });
      upserted++;
    }
  }

  return { upserted, skipped };
}

export async function ingestSignal(db: Db, signal: SignalEvent): Promise<{ id: string; entityId: string }> {
  let entityId = signal.entityId;

  if (!entityId && signal.entityName) {
    const found = await findEntity(db, signal.entityName);
    if (found) entityId = found.id;
  }

  if (!entityId) {
    throw new Error('Could not resolve entity for signal — provide entityId or a matchable entityName');
  }

  const [row] = await db.insert(signalEvents).values({
    entityId,
    source: signal.source,
    signalType: signal.signalType,
    rawData: signal.rawData || {},
    confidence: signal.confidence,
    observedAt: new Date(signal.observedAt),
  }).returning();

  await checkConvergence(db, entityId);

  return { id: row.id, entityId };
}

export async function checkConvergence(db: Db, entityId: string): Promise<void> {
  const events = await db.select().from(signalEvents)
    .where(eq(signalEvents.entityId, entityId));

  if (events.length < 2) return;

  const sorted = events.sort((a, b) =>
    new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime()
  );

  const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < sorted.length; i++) {
    const windowStart = new Date(sorted[i].observedAt);
    const windowEnd = new Date(windowStart.getTime() + WINDOW_MS);

    const inWindow = sorted.filter(e => {
      const t = new Date(e.observedAt).getTime();
      return t >= windowStart.getTime() && t <= windowEnd.getTime();
    });

    const distinctTypes = new Set(inWindow.map(e => e.signalType));
    const distinctSources = new Set(inWindow.map(e => e.source));

    if (distinctTypes.size >= 2 && distinctSources.size >= 2) {
      const eventIds = inWindow.map(e => e.id);
      const score = Math.min((distinctTypes.size * distinctSources.size) / 10, 1.0);

      // Check overlap with existing convergences
      const existing = await db.select().from(signalConvergences)
        .where(eq(signalConvergences.entityId, entityId));

      const overlaps = existing.some(conv => {
        const existingIds = new Set(conv.signalEventIds);
        const overlap = eventIds.filter(id => existingIds.has(id));
        return overlap.length > existingIds.size * 0.5;
      });

      if (!overlaps) {
        await db.insert(signalConvergences).values({
          entityId,
          signalEventIds: eventIds,
          convergenceScore: score,
          windowStart,
          windowEnd,
        });
      }
    }
  }
}

export async function getConvergences(
  db: Db,
  options: { unposted?: boolean } = {},
): Promise<Array<Record<string, unknown>>> {
  if (options.unposted) {
    return db.select().from(signalConvergences)
      .where(eq(signalConvergences.postedToSourcing, false));
  }
  return db.select().from(signalConvergences);
}
