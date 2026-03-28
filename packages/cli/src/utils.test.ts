import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFiles } = vi.hoisted(() => ({
  mockFiles: new Map<string, string>(),
}));

vi.mock('node:fs', () => ({
  existsSync: (path: string) => mockFiles.has(String(path)),
  readFileSync: (path: string) => {
    const content = mockFiles.get(String(path));
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${String(path)}'`);
    }
    return content;
  },
  writeFileSync: (path: string, content: string) => {
    mockFiles.set(String(path), content);
  },
}));

import { ENV_EXAMPLE_PATH, ENV_PATH, mask, parseEnvFile, updateEnvFile } from './utils.js';

describe('mask', () => {
  it('masks middle of long strings', () => {
    expect(mask('blather_abc12345def')).toBe('blat••••5def');
  });

  it('fully masks short strings', () => {
    expect(mask('abc')).toBe('••••••••');
    expect(mask('12345678')).toBe('••••••••');
  });

  it('shows first 4 and last 4 of longer strings', () => {
    expect(mask('abcdefghij')).toBe('abcd••••ghij');
  });
});

describe('parseEnvFile', () => {
  beforeEach(() => {
    mockFiles.clear();
  });

  it('returns empty object for missing file', () => {
    expect(parseEnvFile('/nonexistent/.env')).toEqual({});
  });

  it('parses key=value pairs, comments, and values containing equals signs', () => {
    mockFiles.set(
      '/tmp/test.env',
      [
        '# comment',
        '',
        'FOO=bar',
        '  # another comment',
        'URL=postgres://user:***@host/db?ssl=true',
        'INVALID_LINE',
      ].join('\n'),
    );

    expect(parseEnvFile('/tmp/test.env')).toEqual({
      FOO: 'bar',
      URL: 'postgres://user:***@host/db?ssl=true',
    });
  });
});

describe('updateEnvFile', () => {
  beforeEach(() => {
    mockFiles.clear();
  });

  it('updates existing keys and appends missing ones in .env', () => {
    mockFiles.set(
      ENV_PATH,
      [
        '# existing config',
        'FOO=old',
        'BAR=keep',
      ].join('\n'),
    );

    updateEnvFile({ FOO: 'new', BAZ: 'added' });

    expect(mockFiles.get(ENV_PATH)).toBe(
      [
        '# existing config',
        'FOO=new',
        'BAR=keep',
        'BAZ=added',
      ].join('\n'),
    );
  });

  it('uses .env.example as a template and activates commented keys', () => {
    mockFiles.set(
      ENV_EXAMPLE_PATH,
      [
        '# RESEND_API_KEY=replace-me',
        '# OPTIONAL_FLAG=true',
      ].join('\n'),
    );

    updateEnvFile({ RESEND_API_KEY: 'secret', NEW_KEY: 'value' });

    expect(mockFiles.get(ENV_PATH)).toBe(
      [
        'RESEND_API_KEY=secret',
        '# OPTIONAL_FLAG=true',
        'NEW_KEY=value',
      ].join('\n'),
    );
  });
});
