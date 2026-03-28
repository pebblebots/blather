import {
  header, ok, info, warn, fail, dim, bold, red, cyan,
  ROOT, DOCKER_COMPOSE_PATH,
  run, getPidsOnPort, hasCommand,
} from './utils.js';
import { existsSync } from 'node:fs';

function killPort(port: number, label: string): boolean {
  const pids = getPidsOnPort(port);
  if (pids.length === 0) {
    info(`${label}: ${dim('not running')}`);
    return false;
  }

  for (const pid of pids) {
    try {
      process.kill(parseInt(pid, 10), 'SIGTERM');
    } catch {
      // already gone
    }
  }
  ok(`${label}: stopped ${dim(`(pid ${pids.join(', ')})`)}`);
  return true;
}

export async function down() {
  console.log(`\n  ${bold(cyan('Stopping Blather'))}\n`);

  // ── Dev servers ───────────────────────────────────────────────────────
  header('Dev Servers');

  killPort(5173, 'Web dev server (:5173)');
  killPort(8080, 'Web server (:8080)');
  killPort(3000, 'API server (:3000)');

  // Also kill any tsx/node processes running blather
  const tsxPids = run(
    `pgrep -f "tsx.*blather|node.*blather.*(api|web)" 2>/dev/null`
  );
  if (tsxPids.ok && tsxPids.stdout) {
    for (const pid of tsxPids.stdout.split('\n').filter(Boolean)) {
      try {
        process.kill(parseInt(pid, 10), 'SIGTERM');
        ok(`Killed orphan process ${dim(`(pid ${pid})`)}`);
      } catch {
        // already gone
      }
    }
  }

  // ── Docker ────────────────────────────────────────────────────────────
  header('Docker Compose');

  if (hasCommand('docker') && existsSync(DOCKER_COMPOSE_PATH)) {
    const containers = run('docker compose ps -q 2>/dev/null');
    if (containers.ok && containers.stdout.length > 0) {
      info('Stopping containers...');
      const result = run('docker compose stop');
      if (result.ok) {
        ok('Docker Compose services stopped');
      } else {
        fail('Failed to stop Docker Compose services');
      }
    } else {
      info(`Docker Compose: ${dim('no running containers')}`);
    }
  } else {
    info(`Docker: ${dim('not available or no docker-compose.yml')}`);
  }

  console.log(`\n  ${bold('Blather is down.')}\n`);
}
