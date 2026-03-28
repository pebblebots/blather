import { createHmac } from 'node:crypto';
import {
  header, ok, info, warn, fail, dim, bold, cyan, yellow, green, red,
  ROOT, ENV_PATH, parseEnvFile, run, hasCommand, mask,
} from './utils.js';

// ── Config ──────────────────────────────────────────────────────────────────

const AGENT_DOMAIN = 'system.blather';

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

function oc(args: string): string | null {
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
  ok(`openclaw found: ${dim(run('openclaw --version') ?? 'unknown')}`);

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
  if (pluginCheck) {
    ok('Plugin already installed');
  } else {
    const result = run(`openclaw plugins install --link ${ROOT}/packages/plugins/blather`);
    if (result === null) {
      fail('Plugin install failed');
      process.exit(1);
    }
    ok('Plugin installed (linked)');
  }

  // 3. Find workspace
  const allWorkspaces = await dbQuery<{ id: string; name: string }>(
    'SELECT id, name FROM workspaces LIMIT 5'
  );
  if (allWorkspaces.length === 0) {
    fail('No workspaces found — create one in the Blather UI first');
    process.exit(1);
  }
  const workspace = allWorkspaces[0];
  ok(`Workspace: ${bold(workspace.name)} ${dim(`(${workspace.id})`)}`);

  // 4. Create agent user + API key
  console.log();
  info('Setting up agent identity...');

  const agentEmail = `openclaw@${AGENT_DOMAIN}`;
  const agentName = 'OpenClaw';

  let agentUser = await findOrCreateAgent(agentEmail, agentName);

  // Ensure workspace membership
  await ensureWorkspaceMember(workspace.id, agentUser.id);

  // Generate API key
  const jwt = signJwt(agentUser.id);
  const keyResult = await apiFetch('/auth/api-keys', {
    method: 'POST',
    token: jwt,
    body: JSON.stringify({ name: 'openclaw' }),
  }) as { key: string };
  ok(`API key: ${dim(mask(keyResult.key))}`);

  // 5. Configure OpenClaw channel
  console.log();
  info('Configuring OpenClaw...');

  oc('config set channels.blather.enabled true --strict-json');
  oc(`config set channels.blather.apiUrl "${apiUrl}"`);
  oc(`config set channels.blather.apiKey "${keyResult.key}"`);
  oc(`config set channels.blather.workspaceId "${workspace.id}"`);
  ok('Channel configured');

  // Done
  console.log();
  header('Ready');
  ok('Blather plugin installed and configured');
  info(`Restart the gateway to activate: ${dim('openclaw daemon restart')}`);
  console.log();
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

  // Find workspace
  const allWorkspaces = await dbQuery<{ id: string; name: string }>(
    'SELECT id, name FROM workspaces LIMIT 5'
  );
  if (allWorkspaces.length === 0) {
    fail('No workspaces found');
    process.exit(1);
  }
  const workspace = allWorkspaces[0];

  // Create or find agent user
  const agentUser = await findOrCreateAgent(email, displayName);
  await ensureWorkspaceMember(workspace.id, agentUser.id);

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
  const hasAgent = agentsList?.includes(`"${name}"`);

  if (hasAgent) {
    oc(`agents bind ${name} blather:${name}`);
    ok(`Bound existing agent ${bold(name)} to blather:${name}`);
  } else {
    oc(`agents add ${name} --bind blather:${name} --non-interactive --workspace ~/.openclaw/agents/${name}/workspace`);
    ok(`Created agent ${bold(name)} with blather:${name} binding`);
  }

  console.log();
  header('Ready');
  ok(`Agent ${bold(name)} added`);
  info(`Restart the gateway to activate: ${dim('openclaw daemon restart')}`);
  console.log();
}

// ── status ──────────────────────────────────────────────────────────────────

async function showStatus() {
  header('OpenClaw Status');

  if (!hasCommand('openclaw')) {
    fail('openclaw CLI not found on PATH');
    return;
  }
  ok(`openclaw: ${dim(run('openclaw --version') ?? 'unknown')}`);

  // Plugin
  console.log();
  info(bold('Plugin'));
  const inspect = oc('plugins inspect blather 2>/dev/null');
  if (inspect) {
    const statusMatch = inspect.match(/Status:\s*(\S+)/);
    const sourceMatch = inspect.match(/Source:\s*(.+)/);
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
  const apiUrl = oc('config get channels.blather.apiUrl 2>/dev/null');
  const wsId = oc('config get channels.blather.workspaceId 2>/dev/null');
  const apiKey = oc('config get channels.blather.apiKey 2>/dev/null');

  const strip = (s: string | null) => s?.replace(/"/g, '').trim() ?? null;

  if (enabled?.includes('true')) {
    ok(`Enabled: ${green('yes')}`);
  } else {
    warn(`Enabled: ${yellow('no')}`);
  }
  info(`API URL: ${dim(strip(apiUrl) ?? 'not set')}`);
  info(`Workspace: ${dim(strip(wsId) ?? 'not set')}`);
  info(`API Key: ${dim(strip(apiKey) ? mask(strip(apiKey)!) : 'not set')}`);

  // Accounts
  const accounts = oc('config get channels.blather.accounts 2>/dev/null');
  if (accounts && accounts !== 'undefined' && accounts !== 'null') {
    console.log();
    info(bold('Accounts'));
    try {
      const parsed = JSON.parse(accounts);
      for (const [id, acct] of Object.entries(parsed as Record<string, any>)) {
        const key = acct.apiKey ? mask(acct.apiKey) : 'inherits default';
        info(`  ${bold(id)}: ${dim(key)}`);
      }
    } catch {
      info(`  ${dim(accounts)}`);
    }
  }

  // Gateway status
  console.log();
  info(bold('Gateway'));
  const chanStatus = oc('channels status 2>/dev/null');
  if (chanStatus) {
    const blatherLine = chanStatus.split('\n').find(l => /blather/i.test(l));
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

  const result = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, displayName, isAgent: true }),
  }) as { user: { id: string } };

  ok(`Created agent user: ${bold(displayName)} ${dim(`<${email}>`)}`);
  return { id: result.user.id };
}

async function ensureWorkspaceMember(workspaceId: string, userId: string) {
  const membership = await dbQuery(
    'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1',
    [workspaceId, userId]
  );
  if (membership.length === 0) {
    await dbQuery(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [workspaceId, userId, 'member']
    );
    ok('Added agent to workspace');
  }
}
