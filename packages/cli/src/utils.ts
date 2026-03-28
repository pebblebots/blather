import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Colors ──────────────────────────────────────────────────────────────────

const c = (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
export const bold = c(1);
export const dim = c(2);
export const red = c(31);
export const green = c(32);
export const yellow = c(33);
export const blue = c(34);
export const cyan = c(36);

// ── Logging ─────────────────────────────────────────────────────────────────

export const log = (msg: string) => console.log(`  ${msg}`);
export const ok = (msg: string) => console.log(`  ${green('✓')} ${msg}`);
export const warn = (msg: string) => console.log(`  ${yellow('⚠')} ${msg}`);
export const fail = (msg: string) => console.log(`  ${red('✗')} ${msg}`);
export const info = (msg: string) => console.log(`  ${blue('•')} ${msg}`);
export const header = (msg: string) => console.log(`\n  ${bold(cyan(msg))}\n`);

// ── Paths ───────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
export const ROOT = resolve(__filename, '..', '..', '..', '..');
export const ENV_PATH = resolve(ROOT, '.env');
export const ENV_EXAMPLE_PATH = resolve(ROOT, '.env.example');
export const DOCKER_COMPOSE_PATH = resolve(ROOT, 'docker-compose.yml');

// ── .env helpers ────────────────────────────────────────────────────────────

export interface EnvConfig {
  [key: string]: string;
}

/** Parse a .env file into a key-value map (ignoring comments and blanks). */
export function parseEnvFile(path: string): EnvConfig {
  if (!existsSync(path)) return {};
  const env: EnvConfig = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

/**
 * Read the full .env file preserving comments and structure,
 * update/add the given key=value pairs, and write back.
 */
export function updateEnvFile(updates: EnvConfig): void {
  let lines: string[] = [];
  if (existsSync(ENV_PATH)) {
    lines = readFileSync(ENV_PATH, 'utf8').split('\n');
  } else if (existsSync(ENV_EXAMPLE_PATH)) {
    lines = readFileSync(ENV_EXAMPLE_PATH, 'utf8').split('\n');
  }

  const remaining = { ...updates };

  // Update existing lines (both active and commented-out)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Match active lines
    const activeMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (activeMatch && activeMatch[1] in remaining) {
      lines[i] = `${activeMatch[1]}=${remaining[activeMatch[1]]}`;
      delete remaining[activeMatch[1]];
      continue;
    }
    // Match commented-out lines like "# RESEND_API_KEY=..."
    const commentMatch = trimmed.match(/^#\s*([A-Z_][A-Z0-9_]*)=/);
    if (commentMatch && commentMatch[1] in remaining) {
      lines[i] = `${commentMatch[1]}=${remaining[commentMatch[1]]}`;
      delete remaining[commentMatch[1]];
      continue;
    }
  }

  // Append any keys that weren't found in existing lines
  for (const [key, value] of Object.entries(remaining)) {
    lines.push(`${key}=${value}`);
  }

  writeFileSync(ENV_PATH, lines.join('\n'));
}

// ── Shell helpers ───────────────────────────────────────────────────────────

/** Run a command synchronously and return trimmed stdout, or null on failure. */
export function run(cmd: string, cwd?: string): string | null {
  try {
    return execSync(cmd, {
      cwd: cwd ?? ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    }).toString().trim();
  } catch {
    return null;
  }
}

/** Check if a command exists on PATH. */
export function hasCommand(cmd: string): boolean {
  return run(`which ${cmd}`) !== null;
}

/** Check if a TCP port is listening (works with Docker-mapped ports). */
export function isPortUp(port: number): boolean {
  try {
    execSync(
      `node -e "const s=require('net').createConnection(${port},'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"`,
      { stdio: 'ignore', timeout: 3000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Async version of isPortUp. */
export function checkPort(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.on('connect', () => { clearTimeout(timer); sock.end(); resolve(true); });
    sock.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

/** Get PID(s) listening on a port, or empty array. */
export function getPidsOnPort(port: number): string[] {
  const result = run(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null`);
  if (!result) return [];
  return result.split('\n').filter(Boolean);
}

/** Spawn a detached background process, return the ChildProcess. */
export function spawnBg(cmd: string, args: string[], cwd?: string): ChildProcess {
  const child = spawn(cmd, args, {
    cwd: cwd ?? ROOT,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  return child;
}

// ── Mask secrets ────────────────────────────────────────────────────────────

export function mask(value: string): string {
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}
