import { Command } from 'commander';
import * as p from '@clack/prompts';
import {
  header, ok, info, fail, dim, bold, cyan, yellow, green,
  ENV_PATH, parseEnvFile,
} from './utils.js';

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

export function registerWorkspaces(): Command {
  const cmd = new Command('workspaces').description('Workspace management');

  cmd.command('ls')
    .description('List all workspaces')
    .action(async () => ls());

  cmd.command('show')
    .description('Show workspace details and members')
    .argument('<name-or-id>', 'workspace name or ID')
    .action(async (nameOrId) => show(nameOrId));

  return cmd;
}

// ── ls ──────────────────────────────────────────────────────────────────────

async function ls() {
  const s = p.spinner();
  s.start('Loading workspaces');

  const rows = await dbQuery<{
    id: string;
    name: string;
    slug: string;
    members: string;
    channels: string;
    created_at: string;
  }>(`SELECT w.id, w.name, w.slug,
      COUNT(DISTINCT wm.user_id) as members,
      COUNT(DISTINCT c.id) as channels,
      w.created_at
    FROM workspaces w
    LEFT JOIN workspace_members wm ON w.id = wm.workspace_id
    LEFT JOIN channels c ON w.id = c.workspace_id
    GROUP BY w.id, w.name, w.slug, w.created_at
    ORDER BY w.created_at`);

  s.stop('Workspaces loaded');

  if (rows.length === 0) {
    p.log.info('No workspaces found');
    return;
  }

  header('Workspaces');

  const nameW = Math.max(4, ...rows.map(r => r.name.length));
  const slugW = Math.max(4, ...rows.map(r => r.slug.length));
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));

  console.log(`  ${dim(pad('NAME', nameW))}  ${dim(pad('SLUG', slugW))}  ${dim('MEMBERS')}  ${dim('CHANNELS')}  ${dim('ID')}`);
  console.log(`  ${dim('─'.repeat(nameW + slugW + 40))}`);

  for (const w of rows) {
    const shortId = dim(w.id.slice(0, 8));
    console.log(`  ${pad(w.name, nameW)}  ${pad(w.slug, slugW)}  ${pad(String(w.members), 7)}  ${pad(String(w.channels), 8)}  ${shortId}`);
  }

  console.log(`\n  ${dim(`${rows.length} workspace${rows.length === 1 ? '' : 's'}`)}\n`);
}

// ── show ────────────────────────────────────────────────────────────────────

async function show(nameOrId: string) {
  const s = p.spinner();
  s.start('Loading workspace');

  const workspaces = await dbQuery<{
    id: string;
    name: string;
    slug: string;
    allowed_domains: string[];
    created_at: string;
  }>(`SELECT id, name, slug, allowed_domains, created_at FROM workspaces
      WHERE id::text ILIKE $1 OR name ILIKE $1 OR slug ILIKE $1 LIMIT 1`,
    [`%${nameOrId}%`]);

  if (workspaces.length === 0) {
    s.stop('Not found');
    p.log.error(`No workspace matching "${nameOrId}"`);
    process.exit(1);
  }

  const w = workspaces[0];

  const members = await dbQuery<{
    id: string;
    email: string;
    display_name: string;
    is_agent: boolean;
    role: string;
  }>(`SELECT u.id, u.email, u.display_name, u.is_agent, wm.role
      FROM workspace_members wm
      JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY u.is_agent, u.display_name`, [w.id]);

  const channels = await dbQuery<{
    id: string;
    name: string;
    channel_type: string;
    is_default: boolean;
  }>(`SELECT id, name, channel_type, is_default FROM channels
      WHERE workspace_id = $1 AND archived = false
      ORDER BY is_default DESC, name`, [w.id]);

  s.stop('Workspace loaded');

  header(w.name);

  info(`ID: ${dim(w.id)}`);
  info(`Slug: ${dim(w.slug)}`);
  if (w.allowed_domains?.length) info(`Domains: ${dim(w.allowed_domains.join(', '))}`);
  info(`Created: ${dim(new Date(w.created_at).toLocaleDateString())}`);

  if (channels.length > 0) {
    console.log();
    info(bold(`Channels (${channels.length})`));
    for (const c of channels) {
      const type = c.channel_type === 'public' ? green('public') : yellow('private');
      const def = c.is_default ? ` ${dim('(default)')}` : '';
      console.log(`  ${bold(c.name)}  ${type}${def}`);
    }
  }

  if (members.length > 0) {
    console.log();
    info(bold(`Members (${members.length})`));

    const nameW = Math.max(4, ...members.map(m => m.display_name.length));
    const emailW = Math.max(5, ...members.map(m => m.email.length));
    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));

    for (const m of members) {
      const type = m.is_agent ? yellow('agent') : green('human');
      const role = m.role === 'admin' ? ` ${cyan('admin')}` : '';
      console.log(`  ${pad(m.display_name, nameW)}  ${dim(pad(m.email, emailW))}  ${type}${role}`);
    }
  } else {
    console.log();
    info('No members');
  }

  console.log();
}
