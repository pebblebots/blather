import postgres from 'postgres';
import {
  header, ok, fail, info, warn, dim, bold, green, red, yellow, cyan,
  ENV_PATH, ROOT,
  parseEnvFile, run, checkPort, mask, hasCommand,
} from './utils.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';

interface MigrationStatus {
  applied: number;
  available: number;
  pending: string[];
}

async function checkMigrations(dbUrl: string): Promise<MigrationStatus | null> {
  const migrationsFolder = resolve(ROOT, 'packages/db/drizzle');
  const journalPath = resolve(migrationsFolder, 'meta/_journal.json');
  if (!existsSync(journalPath)) return null;

  const allMigrations = readMigrationFiles({ migrationsFolder });
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  // Build hash→tag map (readMigrationFiles and journal.entries are in the same order)
  const hashToTag = new Map(allMigrations.map((m, i) => [m.hash, journal.entries[i]?.tag ?? m.hash.slice(0, 12)]));

  const sql = postgres(dbUrl, { connect_timeout: 3, max: 1 });
  try {
    const rows = await sql<{ hash: string }[]>`
      SELECT hash FROM drizzle.__drizzle_migrations
    `;
    const appliedHashes = new Set(rows.map((r) => r.hash));
    const pending = allMigrations.filter((m) => !appliedHashes.has(m.hash));
    return {
      applied: appliedHashes.size,
      available: allMigrations.length,
      pending: pending.map((m) => hashToTag.get(m.hash)!),
    };
  } catch {
    return { applied: 0, available: allMigrations.length, pending: journal.entries.map((e) => e.tag) };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function checkPostgres(dbUrl: string): Promise<{ ok: boolean; detail?: string }> {
  const sql = postgres(dbUrl, { connect_timeout: 3, max: 1 });
  try {
    const [row] = await sql`SELECT version()`;
    const version = (row as { version: string }).version.split(' ').slice(0, 2).join(' ');
    return { ok: true, detail: version };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function status() {
  console.log(`\n  ${bold(cyan('Blather Status'))}\n`);

  // ── .env ────────────────────────────────────────────────────────────────
  header('Environment');

  if (existsSync(ENV_PATH)) {
    ok(`.env file exists`);
  } else {
    fail(`.env file missing — run ${bold('bla setup')}`);
  }

  const env = parseEnvFile(ENV_PATH);

  const required: [string, string][] = [
    ['DATABASE_URL', 'Database'],
    ['JWT_SECRET', 'JWT Secret'],
  ];

  const optional: [string, string][] = [
    ['RESEND_API_KEY', 'Resend (email)'],
    ['RESEND_FROM', 'Resend sender'],
    ['OPENAI_API_KEY', 'OpenAI (TTS)'],
    ['ELEVENLABS_API_KEY', 'ElevenLabs (TTS)'],
    ['AGENT_EMAIL_DOMAIN', 'Agent domains'],
  ];

  for (const [key, label] of required) {
    const val = env[key];
    if (!val) {
      fail(`${label}: ${dim('not set')}`);
    } else if (key === 'JWT_SECRET' && val === 'change-me-to-a-random-secret') {
      warn(`${label}: ${yellow('using default (change for production)')}`);
    } else {
      ok(`${label}: ${dim(mask(val))}`);
    }
  }

  for (const [key, label] of optional) {
    const val = env[key];
    if (!val) {
      info(`${label}: ${dim('not configured')}`);
    } else {
      ok(`${label}: ${dim(mask(val))}`);
    }
  }

  // ── Services ──────────────────────────────────────────────────────────
  header('Services');

  // Docker Compose
  const dockerOk = hasCommand('docker');
  if (!dockerOk) {
    fail(`Docker: ${dim('not found on PATH')}`);
  } else {
    const containers = run(`docker compose ps --format json 2>/dev/null`);
    if (containers.ok && containers.stdout.length > 2) {
      const running = containers.stdout.includes('"running"');
      if (running) {
        ok(`Docker Compose: ${green('running')}`);
      } else {
        warn(`Docker Compose: ${yellow('containers exist but not running')}`);
      }
    } else {
      info(`Docker Compose: ${dim('no containers')}`);
    }
  }

  // PostgreSQL — connect using @blather/db
  const dbUrl = env['DATABASE_URL'] || 'postgresql://blather:blather-dev@localhost:5432/blather';
  const pg = await checkPostgres(dbUrl);
  if (pg.ok) {
    ok(`PostgreSQL: ${green('connected')} ${dim(pg.detail ?? '')}`);
  } else {
    fail(`PostgreSQL: ${red('connection failed')} ${dim(pg.detail ?? '')}`);
  }

  // Migrations
  if (pg.ok) {
    const mig = await checkMigrations(dbUrl);
    if (mig) {
      if (mig.pending.length === 0) {
        ok(`Migrations: ${green('up to date')} ${dim(`(${mig.applied}/${mig.available} applied)`)}`);
      } else {
        warn(`Migrations: ${yellow(`${mig.pending.length} pending`)} ${dim(`(${mig.applied}/${mig.available} applied)`)}`);
        for (const tag of mig.pending) {
          info(`  ${dim('→')} ${tag}`);
        }
        info(`Run ${bold('pnpm --filter @blather/db run migrate')} to apply`);
      }
    }
  }

  // API + Web — check in parallel
  const [apiUp, webDevUp, webProdUp] = await Promise.all([
    checkPort(3000),
    checkPort(5173),
    checkPort(8080),
  ]);

  if (apiUp) {
    ok(`API server: ${green('running')} ${dim('on :3000')}`);
  } else {
    info(`API server: ${dim('not running')}`);
  }

  if (webDevUp) {
    ok(`Web dev server: ${green('running')} ${dim('on :5173')}`);
  } else if (webProdUp) {
    ok(`Web server: ${green('running')} ${dim('on :8080 (production)')}`);
  } else {
    info(`Web server: ${dim('not running')}`);
  }

  console.log();
}
