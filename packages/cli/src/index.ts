#!/usr/bin/env node

import { Command } from 'commander';
import { red } from './utils.js';

const program = new Command()
  .name('bla')
  .description('Blather CLI')
  .version('0.1.0');

program.command('status')
  .description('Show service status and configuration')
  .action(async () => (await import('./status.js')).status());

program.command('setup')
  .description('Quick setup with sensible defaults')
  .option('--advanced', 'prompt for every setting')
  .action(async () => (await import('./setup.js')).setup());

program.command('up')
  .description('Start all services (DB, API, Web)')
  .action(async () => (await import('./up.js')).up());

program.command('down')
  .description('Stop all services')
  .action(async () => (await import('./down.js')).down());

program.command('openclaw')
  .description('OpenClaw integration (init, add, status)')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async () => (await import('./openclaw.js')).openclaw());

// Users — fully commander-based
const usersCmd = (await import('./users.js')).registerUsers();
program.addCommand(usersCmd);

const workspacesCmd = (await import('./workspaces.js')).registerWorkspaces();
program.addCommand(workspacesCmd);

await program.parseAsync();
