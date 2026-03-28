import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output, exit } from 'node:process';
import { randomBytes } from 'node:crypto';
import {
  header, ok, info, warn, dim, bold, green, yellow, cyan,
  ENV_PATH, parseEnvFile, updateEnvFile, mask,
} from './utils.js';
import { existsSync } from 'node:fs';

// ── Radio select ───────────────────────────────────────────────────────────

interface SelectOption { label: string; hint?: string; value: string }

/** Arrow-key / j-k radio selector. Returns the chosen value. */
function selectOne(options: SelectOption[], initial = 0): Promise<string> {
  return new Promise((resolve) => {
    let cursor = initial;
    const wasRaw = input.isRaw;

    function render() {
      // Move up to overwrite previous render (skip on first paint)
      if (rendered) output.write(`\x1b[${options.length}A`);
      for (let i = 0; i < options.length; i++) {
        const bullet = i === cursor ? green('●') : dim('○');
        const label = i === cursor ? bold(options[i].label) : options[i].label;
        const hint = options[i].hint ? ` ${dim(options[i].hint!)}` : '';
        output.write(`\x1b[2K  ${bullet} ${label}${hint}\n`);
      }
      rendered = true;
    }

    let rendered = false;
    input.setRawMode(true);
    input.resume();
    render();

    function onData(data: Buffer) {
      const key = data.toString();
      if (key === '\x1b[A' || key === 'k') {           // up
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') {    // down
        cursor = (cursor + 1) % options.length;
        render();
      } else if (key === '\r' || key === '\n') {        // enter
        cleanup();
        resolve(options[cursor].value);
      } else if (key === '\x03') {                       // ctrl-c
        cleanup();
        exit(130);
      }
    }

    function cleanup() {
      input.removeListener('data', onData);
      input.setRawMode(wasRaw ?? false);
      input.pause();
    }

    input.on('data', onData);
  });
}

// ── Field definitions ──────────────────────────────────────────────────────

interface SetupField {
  key: string;
  label: string;
  section: string;
  required: boolean;
  default?: string;
  hint?: string;
  secret?: boolean;
  generate?: () => string;
  /** If true, only shown in --advanced mode */
  advanced?: boolean;
}

const fields: SetupField[] = [
  {
    key: 'VITE_API_URL',
    label: 'API URL',
    section: 'API',
    required: true,
    default: 'http://localhost:3000',
    hint: 'Base URL for the Blather API (used by the web frontend proxy)',
    advanced: true,
  },
  {
    key: 'DATABASE_URL',
    label: 'Database URL',
    section: 'Database',
    required: true,
    default: 'postgresql://blather:blather-dev@localhost:5432/blather',
    hint: 'PostgreSQL connection string',
    advanced: true,
  },
  {
    key: 'RESEND_API_KEY',
    label: 'Resend API Key',
    section: 'Email (optional)',
    required: false,
    secret: true,
    hint: 'For sending magic link emails — without it, links log to console\n  Get a key at https://resend.com/api-keys',
  },
  {
    key: 'RESEND_FROM',
    label: 'Resend From Address',
    section: 'Email (optional)',
    required: false,
    hint: 'e.g. Blather <noreply@yourdomain.com>',
    advanced: true,
  },
  // TTS is handled separately via selectOne — not in this array
  {
    key: 'BLA_ALLOWED_EMAILS',
    label: 'Allowed Emails',
    section: 'Access Control',
    required: false,
    hint: 'Comma-separated patterns with wildcards, e.g. *@yourcompany.com,admin@example.com\n  Leave empty to disable email login entirely (API-key only)',
  },
  {
    key: 'AGENT_EMAIL_DOMAIN',
    label: 'Agent Email Domains',
    section: 'Agents (optional)',
    required: false,
    hint: 'Comma-separated domains for agent detection, e.g. system.blather,yourdomain.com',
    advanced: true,
  },
];

export async function setup() {
  const advanced = process.argv.includes('--advanced');

  const env = parseEnvFile(ENV_PATH);
  const updates: Record<string, string> = {};

  // Auto-generate JWT_SECRET if missing or still the insecure placeholder
  const jwtSecret = env['JWT_SECRET'];
  if (!jwtSecret || jwtSecret === 'change-me-to-a-random-secret') {
    updates['JWT_SECRET'] = randomBytes(32).toString('base64url');
  }

  if (advanced) {
    await advancedSetup(env, updates);
  } else {
    await quickSetup(env, updates);
  }

  // Write updates
  if (Object.keys(updates).length > 0) {
    updateEnvFile(updates);
    header('Done');
    ok(`.env updated at ${dim(ENV_PATH)}`);
    for (const [key, value] of Object.entries(updates)) {
      const field = fields.find(f => f.key === key);
      const display = field?.secret ? mask(value) : value;
      info(`${key} = ${dim(display)}`);
    }
  } else {
    header('Done');
    info('No changes made.');
  }

  console.log(`\n  ${dim('Run')} ${bold('bla up')} ${dim('to start Blather.')}\n`);
}

// ── TTS provider selection ─────────────────────────────────────────────────

const ttsOptions: SelectOption[] = [
  { label: 'Skip',       hint: '(recommended)', value: 'skip' },
  { label: 'OpenAI',     hint: '(fun)',         value: 'openai' },
  { label: 'ElevenLabs', hint: '(fun)',         value: 'elevenlabs' },
];

async function promptTts(
  rl: readline.Interface,
  env: Record<string, string>,
  updates: Record<string, string>,
) {
  header('TTS for Huddles (optional)');
  console.log(`  ${dim('Voice chat text-to-speech provider')}\n`);

  // Pre-select based on existing config
  let initial = 0;
  if (env['OPENAI_API_KEY']) initial = 1;
  else if (env['ELEVENLABS_API_KEY']) initial = 2;

  const choice = await selectOne(ttsOptions, initial);

  if (choice === 'openai') {
    console.log();
    const existing = env['OPENAI_API_KEY'];
    if (existing) info(`Current: ${green(mask(existing))}`);
    const promptStr = existing
      ? `  OpenAI API Key ${dim('[Enter=keep]')}: `
      : `  OpenAI API Key: `;
    const answer = (await rl.question(promptStr)).trim();
    if (answer) updates['OPENAI_API_KEY'] = answer;
  } else if (choice === 'elevenlabs') {
    console.log();
    const existing = env['ELEVENLABS_API_KEY'];
    if (existing) info(`Current: ${green(mask(existing))}`);
    const promptStr = existing
      ? `  ElevenLabs API Key ${dim('[Enter=keep]')}: `
      : `  ElevenLabs API Key: `;
    const answer = (await rl.question(promptStr)).trim();
    if (answer) updates['ELEVENLABS_API_KEY'] = answer;
  }

  console.log();
}

// ── Setup modes ────────────────────────────────────────────────────────────

/** Apply defaults for infra, prompt for API keys. */
async function quickSetup(env: Record<string, string>, updates: Record<string, string>) {
  const rl = readline.createInterface({ input, output });

  console.log(`\n  ${bold(cyan('Blather Quick Setup'))}`);
  console.log(`  ${dim('Use')} ${bold('bla setup --advanced')} ${dim('to configure database, URLs, and more.')}\n`);

  // Silently apply defaults for advanced fields
  for (const field of fields) {
    if (!field.advanced) continue;
    const existing = env[field.key];
    const hasExisting = existing !== undefined && existing.length > 0;
    if (!hasExisting && field.default) {
      updates[field.key] = field.default;
    }
  }

  // Prompt for non-advanced fields (API keys etc.)
  let currentSection = '';

  for (const field of fields) {
    if (field.advanced) continue;

    if (field.section !== currentSection) {
      currentSection = field.section;
      header(currentSection);
    }

    const existing = env[field.key];
    const hasExisting = existing !== undefined && existing.length > 0;

    if (hasExisting) {
      const display = field.secret ? mask(existing) : existing;
      info(`Current: ${green(display)}`);
    }

    if (field.hint) {
      console.log(`  ${dim(field.hint)}`);
    }

    let promptStr = `  ${field.label}`;
    if (hasExisting) {
      promptStr += ` ${dim('[Enter=keep]')}`;
    } else if (!field.required) {
      promptStr += ` ${dim('[Enter=skip]')}`;
    }
    promptStr += ': ';

    const answer = (await rl.question(promptStr)).trim();

    if (answer) {
      updates[field.key] = answer;
    }

    console.log();
  }

  // TTS provider choice
  await promptTts(rl, env, updates);

  rl.close();
}

/** Interactive prompt for every field. */
async function advancedSetup(env: Record<string, string>, updates: Record<string, string>) {
  const rl = readline.createInterface({ input, output });

  console.log(`\n  ${bold(cyan('Blather Setup'))}`);
  console.log(`  ${dim('Configure your environment. Press Enter to keep current values.')}\n`);

  if (updates['JWT_SECRET']) {
    ok(`JWT_SECRET auto-generated`);
    console.log();
  }

  let currentSection = '';

  for (const field of fields) {
    if (field.section !== currentSection) {
      currentSection = field.section;
      header(currentSection);
    }

    const existing = env[field.key];
    const hasExisting = existing !== undefined && existing.length > 0;

    if (hasExisting) {
      const display = field.secret ? mask(existing) : existing;
      info(`Current: ${green(display)}`);
    }

    if (field.hint) {
      console.log(`  ${dim(field.hint)}`);
    }

    let promptStr = `  ${field.label}`;
    if (field.generate && !hasExisting) {
      promptStr += ` ${dim('[Enter=generate random]')}`;
    } else if (hasExisting) {
      promptStr += ` ${dim('[Enter=keep]')}`;
    } else if (field.default) {
      promptStr += ` ${dim(`[Enter=${field.default}]`)}`;
    } else if (!field.required) {
      promptStr += ` ${dim('[Enter=skip]')}`;
    }
    promptStr += ': ';

    const answer = (await rl.question(promptStr)).trim();

    if (answer) {
      updates[field.key] = answer;
    } else if (field.generate && !hasExisting) {
      const generated = field.generate();
      updates[field.key] = generated;
      ok(`Generated: ${dim(mask(generated))}`);
    } else if (!hasExisting && field.default) {
      updates[field.key] = field.default;
    }

    console.log();
  }

  // TTS provider choice
  await promptTts(rl, env, updates);

  rl.close();
}
