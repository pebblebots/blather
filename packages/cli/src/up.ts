import { spawn, type ChildProcess } from 'node:child_process';
import {
  header, ok, fail, info, warn, log, dim, bold, green, yellow, red, cyan,
  ROOT, ENV_PATH, DOCKER_COMPOSE_PATH,
  parseEnvFile, run, isPortUp, hasCommand, getPidsOnPort,
} from './utils.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function streamProcess(label: string, cmd: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n').filter(Boolean)) {
        log(`${dim(`[${label}]`)} ${line}`);
      }
    });
    proc.stderr?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n').filter(Boolean)) {
        log(`${dim(`[${label}]`)} ${line}`);
      }
    });
    proc.on('close', (code) => resolve(code === 0));
  });
}

function spawnService(label: string, cmd: string, args: string[], cwd: string): ChildProcess {
  const proc = spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...parseEnvFile(ENV_PATH), FORCE_COLOR: '1' },
  });

  proc.stdout?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.log(`  ${dim(`[${label}]`)} ${line}`);
    }
  });
  proc.stderr?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.log(`  ${dim(`[${label}]`)} ${line}`);
    }
  });

  return proc;
}

function waitForPort(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (isPortUp(port)) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(check, 500);
    };
    check();
  });
}

export async function up() {
  console.log(`\n  ${bold(cyan('Starting Blather'))}\n`);

  // ── Preflight checks ──────────────────────────────────────────────────
  if (!existsSync(ENV_PATH)) {
    fail(`.env not found — run ${bold('bla setup')} first`);
    process.exit(1);
  }

  const env = parseEnvFile(ENV_PATH);

  // ── 1. Docker / PostgreSQL ─────────────────────────────────────────────
  header('PostgreSQL');

  if (isPortUp(5432)) {
    ok('PostgreSQL already running on :5432');
  } else if (hasCommand('docker') && existsSync(DOCKER_COMPOSE_PATH)) {
    info('Starting PostgreSQL via Docker Compose...');
    const success = await streamProcess('docker', 'docker', ['compose', 'up', '-d'], ROOT);
    if (success) {
      info('Waiting for PostgreSQL to be ready...');
      const ready = await waitForPort(5432, 20000);
      if (ready) {
        ok('PostgreSQL is up on :5432');
      } else {
        fail('PostgreSQL did not start in time');
        process.exit(1);
      }
    } else {
      fail('Docker Compose failed to start');
      process.exit(1);
    }
  } else {
    fail('PostgreSQL is not running and Docker is not available');
    info(`Either start PostgreSQL manually, or install Docker and run ${bold('bla up')} again`);
    process.exit(1);
  }

  // ── 2. Migrations ─────────────────────────────────────────────────────
  header('Database Migrations');

  info('Running migrations...');
  const migrateOk = await streamProcess(
    'migrate',
    'pnpm', ['--filter', '@blather/db', 'run', 'migrate'],
    ROOT,
  );
  if (migrateOk) {
    ok('Migrations complete');
  } else {
    warn('Migration failed — the database may need manual attention');
  }

  // ── 3. API Server ─────────────────────────────────────────────────────
  header('API Server');

  if (isPortUp(3000)) {
    ok('API server already running on :3000');
  } else {
    info('Starting API server...');
    const apiProc = spawnService(
      'api',
      'pnpm', ['--filter', '@blather/api', 'run', 'dev'],
      ROOT,
    );

    const apiUp = await waitForPort(3000);
    if (apiUp) {
      ok(`API server running on :3000 ${dim(`(pid ${apiProc.pid})`)}`);
    } else {
      warn('API server may still be starting — check logs above');
    }
  }

  // ── 4. Web Dev Server ─────────────────────────────────────────────────
  header('Web Dev Server');

  if (isPortUp(5173)) {
    ok('Web dev server already running on :5173');
  } else {
    info('Starting Web dev server...');
    const webProc = spawnService(
      'web',
      'pnpm', ['--filter', '@blather/web', 'run', 'dev'],
      ROOT,
    );

    const webUp = await waitForPort(5173);
    if (webUp) {
      ok(`Web dev server running on :5173 ${dim(`(pid ${webProc.pid})`)}`);
    } else {
      warn('Web dev server may still be starting — check logs above');
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  header('Ready');
  console.log(`  ${bold(green('Blather is up!'))}\n`);
  info(`App:    ${cyan('http://localhost:5173')}`);
  info(`API:    ${cyan('http://localhost:3000')}`);
  info(`DB:     ${dim(env['DATABASE_URL'] || 'localhost:5432')}`);
  console.log(`\n  ${dim('Press Ctrl+C to stop, or run')} ${bold('bla down')} ${dim('from another terminal.')}\n`);

  // Keep the process alive so child processes stay attached
  process.on('SIGINT', () => {
    console.log(`\n  ${dim('Shutting down...')}`);
    process.exit(0);
  });
  process.on('SIGTERM', () => process.exit(0));

  // Block forever
  await new Promise(() => {});
}
