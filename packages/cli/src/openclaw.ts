import { createHmac } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  header, ok, info, warn, fail, dim, bold, cyan, yellow, green, red,
  ROOT, ENV_PATH, parseEnvFile, run, runPassthrough, hasCommand, mask,
} from './utils.js';

// ── Config ──────────────────────────────────────────────────────────────────

export const AGENT_DOMAIN = 'system.blather';

/** Extract #channel slugs from template content (ignores markdown headers). */
export function parseChannelRefs(content: string): string[] {
  const pattern = /(?<=\s|^)#([a-z][a-z0-9_-]*)/g;
  const refs = new Set<string>();
  for (const match of content.matchAll(pattern)) {
    refs.add(match[1]);
  }
  return [...refs];
}

/** Replace template variables ($KEY) in content. */
export function applyTemplateVars(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

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

// ── API helpers ─────────────────────────────────────────────────────────────

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

/** Sign a HS256 JWT using the same secret as the API server. No deps needed. */
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

// ── OpenClaw CLI helpers ────────────────────────────────────────────────────

function oc(args: string) {
  return run(`openclaw ${args}`);
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

// ── Commands ────────────────────────────────────────────────────────────────

export async function openclaw() {
  const sub = process.argv[3];
  switch (sub) {
    case 'init':
      return init();
    case 'add':
      return add();
    case 'status':
      return showStatus();
    case '--help':
    case '-h':
    case undefined:
      return showHelp();
    default:
      console.log(`\n  ${red(`Unknown subcommand: ${sub}`)}`);
      return showHelp();
  }
}

function showHelp() {
  console.log(`
  ${bold(cyan('bla openclaw'))} — OpenClaw integration

  ${bold('Commands:')}
    ${bold('init')}      Install plugin + configure channel (first-time setup)
    ${bold('add')}       Add another agent identity
                ${dim('<name>  agent name (required)')}
                ${dim('--email <email>  custom email (default: <name>@system.blather)')}
                ${dim('--display-name <name>  display name in Blather')}
    ${bold('status')}    Show plugin, channel, and agent status
`);
}

// ── init ────────────────────────────────────────────────────────────────────

async function init() {
  header('OpenClaw Init');

  // 1. Check prerequisites
  if (!hasCommand('openclaw')) {
    fail('openclaw CLI not found on PATH');
    info(`Install: ${dim('npm install -g openclaw')}`);
    process.exit(1);
  }
  ok(`openclaw found: ${dim(run('openclaw --version').stdout || 'unknown')}`);

  const apiUrl = getApiUrl();
  info(`Blather API: ${dim(apiUrl)}`);

  // Check API is reachable
  try {
    await fetch(`${apiUrl}/`);
    ok('API is reachable');
  } catch {
    fail(`Cannot reach ${apiUrl} — is Blather running? (${dim('bla up')})`);
    process.exit(1);
  }

  // 2. Install plugin (link from repo root)
  console.log();
  info('Installing Blather plugin...');
  const pluginCheck = oc('plugins inspect blather 2>/dev/null');
  if (pluginCheck.ok) {
    ok('Plugin already installed');
  } else {
    const result = run(`openclaw plugins install --link ${ROOT}/packages/plugins/openclaw_blather`);
    if (!result.ok) {
      fail(`Plugin install failed: ${result.stderr || result.stdout}`);
      process.exit(1);
    }
    ok('Plugin installed (linked)');
  }

  // 3. Configure OpenClaw channel
  console.log();
  info('Configuring OpenClaw...');

  oc('config set channels.blather.enabled true --strict-json');
  oc(`config set channels.blather.apiUrl "${apiUrl}"`);
  ok('Channel configured');

  // 4. Register clankers from clankers/ directory
  await initBuiltInClankers(apiUrl);

  // Restart gateway
  console.log();
  info('Restarting OpenClaw gateway...');
  if (!runPassthrough('openclaw daemon restart')) {
    warn('Could not restart gateway');
    info(`Try manually: ${dim('openclaw daemon restart')}`);
  }

  // Done
  console.log();
  header('Ready');
  ok('Blather plugin installed and configured');
  console.log();
}

// ── built-in clankers ──────────────────────────────────────────────────────

async function initBuiltInClankers(apiUrl: string) {
  const clankersDir = resolve(ROOT, 'clankers');
  if (!existsSync(clankersDir)) return;

  const clankerDirs = readdirSync(clankersDir, { withFileTypes: true })
    .filter(e => e.isDirectory());
  if (clankerDirs.length === 0) return;

  const env = parseEnvFile(ENV_PATH);
  // Derive web URL: same host as API but port 8080
  const webUrl = env['VITE_WEB_URL'] || apiUrl.replace(/:\d+([/?#].*)?$/, ':8080');

  const templateVars: Record<string, string> = {
    '$API_BASE': apiUrl,
    '$WEB_URL': webUrl,
    '$REPO_ROOT_PATH': ROOT,
  };

  // Scan all clanker templates for #channel references and ensure they exist
  await ensureClankerChannels(clankersDir, clankerDirs.map(d => d.name));

  console.log();
  info(`Registering ${clankerDirs.length} built-in clanker(s)...`);

  for (const dir of clankerDirs) {
    const name = dir.name;
    const clankerPath = resolve(clankersDir, name);

    console.log();
    info(bold(`Clanker: ${name}`));

    // Create agent user
    const email = `${name}@${AGENT_DOMAIN}`;
    const displayName = name;
    const agentUser = await findOrCreateAgent(email, displayName);

    // Generate API key
    const jwt = signJwt(agentUser.id);
    const keyResult = await apiFetch('/auth/api-keys', {
      method: 'POST',
      token: jwt,
      body: JSON.stringify({ name: `clanker-${name}` }),
    }) as { key: string };
    ok(`API key: ${dim(mask(keyResult.key))}`);

    // Configure OpenClaw account
    oc(`config set channels.blather.accounts.${name}.apiKey "${keyResult.key}"`);

    // Add or bind OpenClaw agent
    const agentWorkspace = `~/.openclaw/agents/${name}/workspace`;
    const agentWorkspaceAbs = resolve(homedir(), '.openclaw', 'agents', name, 'workspace');
    const agentsList = oc('agents list --json 2>/dev/null');
    const hasAgent = agentsList.ok && agentsList.stdout.includes(`"${name}"`);

    if (hasAgent) {
      oc(`agents bind ${name} blather:${name}`);
      ok(`Bound existing agent ${bold(name)} to blather:${name}`);
    } else {
      oc(`agents add ${name} --bind blather:${name} --non-interactive --workspace ${agentWorkspace}`);
      ok(`Created agent ${bold(name)} with blather:${name} binding`);
    }

    // Copy template files with variable substitution
    mkdirSync(agentWorkspaceAbs, { recursive: true });
    const files = readdirSync(clankerPath, { withFileTypes: true })
      .filter(e => e.isFile());

    for (const file of files) {
      const raw = readFileSync(resolve(clankerPath, file.name), 'utf8');
      writeFileSync(resolve(agentWorkspaceAbs, file.name), applyTemplateVars(raw, templateVars));
    }
    ok(`Copied ${files.length} template file(s) with config applied`);
  }
}

/** Scan clanker template files for #channel references and create missing channels. */
async function ensureClankerChannels(
  clankersDir: string,
  clankerNames: string[],
) {
  // Collect all #channel references from template files
  const allRefs = new Set<string>();
  for (const name of clankerNames) {
    const clankerPath = resolve(clankersDir, name);
    const files = readdirSync(clankerPath, { withFileTypes: true }).filter(e => e.isFile());
    for (const file of files) {
      const content = readFileSync(resolve(clankerPath, file.name), 'utf8');
      for (const ref of parseChannelRefs(content)) {
        allRefs.add(ref);
      }
    }
  }

  if (allRefs.size === 0) return;

  // Check which channels already exist
  const existing = await dbQuery<{ slug: string }>(
    'SELECT slug FROM channels',
  );
  const existingSlugs = new Set(existing.map(r => r.slug));

  const missing = [...allRefs].filter(slug => !existingSlugs.has(slug));
  if (missing.length === 0) return;

  console.log();
  info(`Creating ${missing.length} channel(s)...`);

  for (const slug of missing) {
    await dbQuery(
      `INSERT INTO channels (name, slug, channel_type, is_default)
       VALUES ($1, $2, 'public', false)`,
      [slug, slug],
    );
    ok(`Created #${slug}`);
  }
}

// ── add ─────────────────────────────────────────────────────────────────────

async function add() {
  const args = process.argv.slice(4);
  const name = args.find(a => !a.startsWith('--'));

  if (!name) {
    fail('Agent name required: bla openclaw add <name>');
    process.exit(1);
  }

  // Parse flags
  let email: string | undefined;
  let displayName: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) email = args[++i];
    if (args[i] === '--display-name' && args[i + 1]) displayName = args[++i];
  }

  email = email ?? `${name}@${AGENT_DOMAIN}`;
  displayName = displayName ?? name;

  header(`Add Agent: ${name}`);

  const apiUrl = getApiUrl();

  // Check API
  try { await fetch(`${apiUrl}/`); } catch {
    fail(`Cannot reach ${apiUrl}`);
    process.exit(1);
  }

  // Create or find agent user
  const agentUser = await findOrCreateAgent(email, displayName);

  // Generate API key
  const jwt = signJwt(agentUser.id);
  const keyResult = await apiFetch('/auth/api-keys', {
    method: 'POST',
    token: jwt,
    body: JSON.stringify({ name: `openclaw-${name}` }),
  }) as { key: string };
  ok(`API key: ${dim(mask(keyResult.key))}`);

  // Configure OpenClaw account
  info('Configuring OpenClaw...');
  oc(`config set channels.blather.accounts.${name}.apiKey "${keyResult.key}"`);

  // Add or bind OpenClaw agent
  const agentsList = oc('agents list --json 2>/dev/null');
  const hasAgent = agentsList.ok && agentsList.stdout.includes(`"${name}"`);

  if (hasAgent) {
    oc(`agents bind ${name} blather:${name}`);
    ok(`Bound existing agent ${bold(name)} to blather:${name}`);
  } else {
    oc(`agents add ${name} --bind blather:${name} --non-interactive --workspace ~/.openclaw/agents/${name}/workspace`);
    ok(`Created agent ${bold(name)} with blather:${name} binding`);
  }

  // Restart gateway
  console.log();
  info('Restarting OpenClaw gateway...');
  if (!runPassthrough('openclaw daemon restart')) {
    warn('Could not restart gateway');
    info(`Try manually: ${dim('openclaw daemon restart')}`);
  }

  console.log();
  header('Ready');
  ok(`Agent ${bold(name)} added`);
  console.log();
}

// ── status ──────────────────────────────────────────────────────────────────

async function showStatus() {
  header('OpenClaw Status');

  if (!hasCommand('openclaw')) {
    fail('openclaw CLI not found on PATH');
    return;
  }
  ok(`openclaw: ${dim(run('openclaw --version').stdout || 'unknown')}`);

  // Plugin
  console.log();
  info(bold('Plugin'));
  const inspect = oc('plugins inspect blather 2>/dev/null');
  if (inspect.ok) {
    const statusMatch = inspect.stdout.match(/Status:\s*(\S+)/);
    const sourceMatch = inspect.stdout.match(/Source:\s*(.+)/);
    ok(`Status: ${statusMatch?.[1] ?? 'unknown'}`);
    if (sourceMatch) info(`Source: ${dim(sourceMatch[1].trim())}`);
  } else {
    fail('Blather plugin not installed');
    info(`Run: ${dim('bla openclaw init')}`);
  }

  // Channel config
  console.log();
  info(bold('Channel'));
  const enabled = oc('config get channels.blather.enabled 2>/dev/null');
  const cfgApiUrl = oc('config get channels.blather.apiUrl 2>/dev/null');
  const apiKey = oc('config get channels.blather.apiKey 2>/dev/null');

  const strip = (s: string) => s.replace(/"/g, '').trim() || null;

  if (enabled.ok && enabled.stdout.includes('true')) {
    ok(`Enabled: ${green('yes')}`);
  } else {
    warn(`Enabled: ${yellow('no')}`);
  }
  info(`API URL: ${dim(strip(cfgApiUrl.stdout) ?? 'not set')}`);
  info(`API Key: ${dim(strip(apiKey.stdout) ? mask(strip(apiKey.stdout)!) : 'not set')}`);

  // Accounts
  const accounts = oc('config get channels.blather.accounts 2>/dev/null');
  if (accounts.ok && accounts.stdout && accounts.stdout !== 'undefined' && accounts.stdout !== 'null') {
    console.log();
    info(bold('Accounts'));
    try {
      const parsed = JSON.parse(accounts.stdout);
      for (const [id, acct] of Object.entries(parsed as Record<string, any>)) {
        const key = acct.apiKey ? mask(acct.apiKey) : 'inherits default';
        info(`  ${bold(id)}: ${dim(key)}`);
      }
    } catch {
      info(`  ${dim(accounts.stdout)}`);
    }
  }

  // Gateway status
  console.log();
  info(bold('Gateway'));
  const chanStatus = oc('channels status 2>/dev/null');
  if (chanStatus.ok) {
    const blatherLine = chanStatus.stdout.split('\n').find((l: string) => /blather/i.test(l));
    if (blatherLine) {
      info(`  ${blatherLine.trim()}`);
    } else {
      warn('Blather not in channel status output');
    }
  } else {
    warn('Could not query gateway status');
  }

  // Auth failures (last 60 min)
  try {
    const apiUrl = getApiUrl();
    const res = await fetch(`${apiUrl}/internal/auth-failures?since_ms=3600000`, {
      headers: { 'Authorization': `Bearer ${getJwtSecret()}` },
    });
    if (res.ok) {
      const failures = await res.json() as {
        reason: string; ip: string | null; path: string;
        apiKeyPrefix: string | null; email: string | null; ts: number;
      }[];
      if (failures.length > 0) {
        console.log();
        info(bold('Auth Failures') + dim(` (last 60m)`));
        warn(`${failures.length} failed auth attempt${failures.length === 1 ? '' : 's'}`);

        const recent = failures.slice(-5).reverse();
        for (const r of recent) {
          const ts = new Date(r.ts).toLocaleTimeString();
          const parts = [r.reason];
          if (r.email) parts.push(`email=${r.email}`);
          if (r.apiKeyPrefix) parts.push(`key=${r.apiKeyPrefix}...`);
          if (r.ip) parts.push(`ip=${r.ip}`);
          if (r.path) parts.push(r.path);
          info(`  ${dim(ts)}  ${parts.join('  ')}`);
        }
      }
    }
  } catch {
    // API unreachable — skip silently
  }

  console.log();
}

// ── Shared helpers ──────────────────────────────────────────────────────────

async function findOrCreateAgent(email: string, displayName: string): Promise<{ id: string }> {
  const existing = await dbQuery<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 LIMIT 1', [email]
  );

  if (existing[0]) {
    ok(`Agent user exists: ${bold(displayName)} ${dim(`<${email}>`)}`);
    return existing[0];
  }

  const [created] = await dbQuery<{ id: string }>(
    `INSERT INTO users (email, display_name, is_agent) VALUES ($1, $2, true) RETURNING id`,
    [email, displayName]
  );

  ok(`Created agent user: ${bold(displayName)} ${dim(`<${email}>`)}`);
  return created;
}

