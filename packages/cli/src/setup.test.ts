import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFiles, mockQuestions, mockSetRawMode, mockResume, mockPause, mockOn, mockRemoveListener, mockWrite, mockExit } = vi.hoisted(() => ({
  mockFiles: new Map<string, string>(),
  mockQuestions: [] as string[],
  mockSetRawMode: vi.fn(),
  mockResume: vi.fn(),
  mockPause: vi.fn(),
  mockOn: vi.fn(),
  mockRemoveListener: vi.fn(),
  mockWrite: vi.fn(),
  mockExit: vi.fn(),
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

vi.mock('node:process', () => ({
  stdin: {
    isRaw: false,
    setRawMode: mockSetRawMode,
    resume: mockResume,
    pause: mockPause,
    on: mockOn,
    removeListener: mockRemoveListener,
  },
  stdout: {
    write: mockWrite,
  },
  exit: mockExit,
}));

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({
    question: vi.fn(async () => mockQuestions.shift() ?? ''),
    close: vi.fn(),
  }),
}));

vi.mock('node:crypto', () => ({
  randomBytes: () => ({ toString: () => 'generated-jwt-secret' }),
}));

import { ENV_PATH } from './utils.js';
import { setup } from './setup.js';

describe('setup', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockQuestions.length = 0;
    mockSetRawMode.mockClear();
    mockResume.mockClear();
    mockPause.mockClear();
    mockOn.mockClear();
    mockRemoveListener.mockClear();
    mockWrite.mockClear();
    mockExit.mockClear();
    mockFiles.set(ENV_PATH, ['JWT_SECRET=change-me-to-a-random-secret', 'RESEND_API_KEY='].join('\n'));
    process.argv = ['node', 'bla', 'setup'];
  });

  it('generates a JWT secret and updates prompted values in quick setup', async () => {
    mockQuestions.push('test-resend-key', '');

    await setup();

    expect(mockFiles.get(ENV_PATH)).toContain('JWT_SECRET=generated-jwt-secret');
    expect(mockFiles.get(ENV_PATH)).toContain('RESEND_API_KEY=test-resend-key');
    expect(mockFiles.get(ENV_PATH)).toContain('VITE_API_URL=http://localhost:3000');
    expect(mockFiles.get(ENV_PATH)).toContain('DATABASE_URL=postgresql://blather:blather-dev@localhost:5432/blather');
    expect(mockSetRawMode).toHaveBeenCalledWith(true);
  });
});
