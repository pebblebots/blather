import { describe, it, expect } from 'vitest';
import { mask, parseEnvFile } from './utils.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  const tmp = join(tmpdir(), `bla-test-${Date.now()}.env`);

  it('returns empty object for missing file', () => {
    expect(parseEnvFile('/nonexistent/.env')).toEqual({});
  });

  it('parses key=value pairs', () => {
    writeFileSync(tmp, 'FOO=bar\nBAZ=qux\n');
    try {
      expect(parseEnvFile(tmp)).toEqual({ FOO: 'bar', BAZ: 'qux' });
    } finally {
      unlinkSync(tmp);
    }
  });

  it('ignores comments and blank lines', () => {
    writeFileSync(tmp, '# comment\n\nFOO=bar\n  # another\nBAZ=1\n');
    try {
      const env = parseEnvFile(tmp);
      expect(env).toEqual({ FOO: 'bar', BAZ: '1' });
    } finally {
      unlinkSync(tmp);
    }
  });

  it('handles values with equals signs', () => {
    writeFileSync(tmp, 'URL=postgres://user:pass@host/db?ssl=true\n');
    try {
      expect(parseEnvFile(tmp)).toEqual({ URL: 'postgres://user:pass@host/db?ssl=true' });
    } finally {
      unlinkSync(tmp);
    }
  });
});
