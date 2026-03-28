import { createHmac } from 'node:crypto';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import {
  header, ok, info, fail, dim, bold, cyan, yellow, green,
  ENV_PATH, parseEnvFile,
} from './utils.js';

// ── Config ──────────────────────────────────────────────────────────────────

function getApiUrl(): string {
  const env = parseEnvFile(ENV_PATH);
  return env['VITE_API_URL'] || 'http://localhost:3000';
}

function getJwtSecret(): string {
  const env = parseEnvFile(ENV_PATH);
  const secret = env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET not set in .env — run `bla setup` first');
  return secret;
}

// ── API / JWT helpers ───────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit & { token?: string }) {
  const url = `${getApiUrl()}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts?.headers as Record<string, string> ?? {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

function signJwt(userId: string): string {
  const secret = getJwtSecret();
  const hdr = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const pay = b64url(JSON.stringify({ sub: userId, iat: now, exp: now + 3600 }));
  const sig = createHmac('sha256', secret).update(`${hdr}.${pay}`).digest();
  return `${hdr}.${pay}.${b64url(sig)}`;
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

// ── DB helpers ──────────────────────────────────────────────────────────────

async function dbQuery<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const env = parseEnvFile(ENV_PATH);
  const dbUrl = env['DATABASE_URL'];
  if (!dbUrl) throw new Error('DATABASE_URL not set — run `bla setup` first');
  const pg = await import('postgres');
  const client = pg.default(dbUrl);
  try {
    return await client.unsafe(sql, params) as T[];
  } finally {
    await client.end();
  }
}

// ── Command registration ────────────────────────────────────────────────────

export function registerUsers(): Command {
  const cmd = new Command('users').description('User management');

  cmd.command('ls')
    .description('List all users')
    .option('--agents', 'only agents')
    .option('--humans', 'only humans')
    .action(async (opts) => ls(opts));

  cmd.command('add')
    .description('Create a new user')
    .argument('[email]', 'email address')
    .option('--name <name>', 'display name')
    .option('--agent', 'mark as agent')
    .action(async (email, opts) => add(email, opts));

  return cmd;
}

// ── ls ──────────────────────────────────────────────────────────────────────

async function ls(opts: { agents?: boolean; humans?: boolean }) {
  const s = p.spinner();
  s.start('Loading users');

  let where = '';
  if (opts.agents) where = ' WHERE is_agent = true';
  else if (opts.humans) where = ' WHERE is_agent = false';

  const rows = await dbQuery<{
    id: string;
    email: string;
    display_name: string;
    is_agent: boolean;
    created_at: string;
  }>(`SELECT id, email, display_name, is_agent, created_at FROM users${where} ORDER BY created_at`);

  s.stop('Users loaded');

  if (rows.length === 0) {
    p.log.info('No users found');
    return;
  }

  header('Users');

  const nameW = Math.max(4, ...rows.map(r => r.display_name.length));
  const emailW = Math.max(5, ...rows.map(r => r.email.length));
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));

  console.log(`  ${dim(pad('NAME', nameW))}  ${dim(pad('EMAIL', emailW))}  ${dim('TYPE')}    ${dim('ID')}`);
  console.log(`  ${dim('─'.repeat(nameW + emailW + 50))}`);

  for (const u of rows) {
    const type = u.is_agent ? yellow('agent') : green('human');
    const shortId = dim(u.id.slice(0, 8));
    console.log(`  ${pad(u.display_name, nameW)}  ${pad(u.email, emailW)}  ${type}   ${shortId}`);
  }

  console.log(`\n  ${dim(`${rows.length} user${rows.length === 1 ? '' : 's'}`)}\n`);
}

// ── add ─────────────────────────────────────────────────────────────────────

async function add(email: string | undefined, opts: { name?: string; agent?: boolean }) {
  p.intro(bold(cyan('Add User')));

  // Interactive prompts for missing args
  if (!email) {
    const value = await p.text({
      message: 'Email address',
      validate: (v) => {
        if (!v) return 'Email is required';
        if (!v.includes('@')) return 'Must be a valid email';
      },
    });
    if (p.isCancel(value)) { p.cancel('Cancelled'); process.exit(0); }
    email = value;
  }

  if (!opts.name) {
    const value = await p.text({
      message: 'Display name',
      defaultValue: email.split('@')[0],
      placeholder: email.split('@')[0],
    });
    if (p.isCancel(value)) { p.cancel('Cancelled'); process.exit(0); }
    opts.name = value;
  }

  if (opts.agent === undefined) {
    const value = await p.confirm({
      message: 'Is this an agent?',
      initialValue: false,
    });
    if (p.isCancel(value)) { p.cancel('Cancelled'); process.exit(0); }
    opts.agent = value;
  }

  const displayName = opts.name ?? email.split('@')[0];
  const isAgent = opts.agent ?? false;

  const s = p.spinner();
  s.start('Creating user');

  // Check if user already exists
  const existing = await dbQuery<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 LIMIT 1', [email]
  );
  if (existing[0]) {
    s.stop('User exists');
    p.log.error(`User with email ${bold(email)} already exists ${dim(`(${existing[0].id.slice(0, 8)})`)}`);
    process.exit(1);
  }

  const [created] = await dbQuery<{ id: string }>(
    `INSERT INTO users (email, display_name, is_agent) VALUES ($1, $2, $3) RETURNING id`,
    [email, displayName, isAgent]
  );

  s.stop('User created');

  p.log.success(`Created ${isAgent ? 'agent' : 'user'}: ${bold(displayName)} ${dim(`<${email}>`)}`);
  p.log.info(`ID: ${dim(created.id)}`);

  p.outro('Done');
}
