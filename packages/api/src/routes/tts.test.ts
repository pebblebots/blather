import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

// Mock fs so we control cache hits/misses and avoid real disk I/O
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      // TTS_DIR creation at module load should succeed
      if (!p.endsWith('.mp3')) return actual.existsSync(p);
      return false; // default: no cache hit
    }),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 1234 })),
    createReadStream: vi.fn(() => {
      // Return an async iterable (minimal readable stream mock)
      return (async function* () {
        yield Buffer.from('fake-mp3-data');
      })();
    }),
  };
});

vi.mock('fs/promises', async () => ({
  writeFile: vi.fn(async () => {}),
}));

// Mock ws/events and ws/manager to prevent side-effects
vi.mock('../ws/events.js', () => ({ emitEvent: vi.fn(async () => {}) }));
vi.mock('../ws/manager.js', () => ({ publishEvent: vi.fn(async () => {}) }));

describe('tts routes', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
    vi.clearAllMocks();

    // Reset existsSync to default: no cache hit for .mp3 files
    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockImplementation((p: any) => {
      if (String(p).endsWith('.mp3')) return false;
      return true; // non-mp3 paths (like TTS_DIR) exist
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  async function createFixture() {
    const user = await harness.factories.createUser({ email: 'tts@test.com', displayName: 'TTS Tester' });
    const channel = await harness.factories.createChannel({ name: 'general', createdBy: user.id });
    return { user, channel };
  }

  async function createMessage(fixture: Awaited<ReturnType<typeof createFixture>>, content = 'Hello world') {
    const res = await harness.request.post<any>(`/channels/${fixture.channel.id}/messages`, {
      headers: harness.headers.forUser(fixture.user.id),
      json: { content },
    });
    return res.body;
  }

  function withApiKey(fn: () => Promise<void>): () => Promise<void> {
    return async () => {
      const origKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key-123';
      try {
        await fn();
      } finally {
        if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
        else delete process.env.OPENAI_API_KEY;
      }
    };
  }

  // ── POST /tts/:messageId ──

  it('returns 404 for nonexistent message', async () => {
    const fixture = await createFixture();

    const res = await harness.request.post('/tts/00000000-0000-0000-0000-000000000000', {
      headers: harness.headers.forUser(fixture.user.id),
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Message not found' });
  });

  it('returns 400 for empty message content', async () => {
    const fixture = await createFixture();
    const msg = await createMessage(fixture, '   ');

    const res = await harness.request.post(`/tts/${msg.id}`, {
      headers: harness.headers.forUser(fixture.user.id),
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Empty message' });
  });

  it('returns 500 when OPENAI_API_KEY is not set', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const fixture = await createFixture();
      const msg = await createMessage(fixture);

      const res = await harness.request.post(`/tts/${msg.id}`, {
        headers: harness.headers.forUser(fixture.user.id),
      });

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ error: 'TTS not configured' });
    } finally {
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
    }
  });

  it('generates TTS audio and returns URL on success', withApiKey(async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    );

    try {
      const fixture = await createFixture();
      const msg = await createMessage(fixture);

      const res = await harness.request.post<any>(`/tts/${msg.id}`, {
        headers: harness.headers.forUser(fixture.user.id),
      });

      expect(res.status).toBe(200);
      expect(res.body.audioUrl).toBe(`/uploads/tts/${msg.id}.mp3`);

      // Verify an external TTS call was made (without asserting on provider internals)
      expect(mockFetch).toHaveBeenCalledOnce();
    } finally {
      mockFetch.mockRestore();
    }
  }));

  it('returns cached URL when TTS file already exists', async () => {
    const { existsSync } = await import('fs');
    const mockedExistsSync = vi.mocked(existsSync);

    // Make existsSync return true for .mp3 files (cache hit)
    mockedExistsSync.mockImplementation((p: any) => {
      if (String(p).endsWith('.mp3')) return true;
      return false;
    });

    const mockFetch = vi.spyOn(globalThis, 'fetch');

    try {
      const fixture = await createFixture();
      const msg = await createMessage(fixture);

      const res = await harness.request.post<any>(`/tts/${msg.id}`, {
        headers: harness.headers.forUser(fixture.user.id),
      });

      expect(res.status).toBe(200);
      expect(res.body.audioUrl).toBe(`/uploads/tts/${msg.id}.mp3`);

      // Cache hit means no external TTS call
      const ttsCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('audio'),
      );
      expect(ttsCalls).toHaveLength(0);
    } finally {
      mockFetch.mockRestore();
    }
  });

  it('returns 500 when TTS provider returns an error', withApiKey(async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"error": "rate limit exceeded"}', {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    try {
      const fixture = await createFixture();
      const msg = await createMessage(fixture);

      const res = await harness.request.post<any>(`/tts/${msg.id}`, {
        headers: harness.headers.forUser(fixture.user.id),
      });

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ error: 'TTS generation failed' });
    } finally {
      mockFetch.mockRestore();
    }
  }));

  it('returns 401 without auth', async () => {
    const res = await harness.request.post('/tts/some-message-id', {});
    expect(res.status).toBe(401);
  });

  // ── GET /tts/:messageId ──

  it('GET returns 404 for nonexistent TTS file', async () => {
    const res = await harness.request.get('/tts/nonexistent-id', {});
    expect(res.status).toBe(404);
  });

  it('GET rejects path traversal attempts', async () => {
    const res = await harness.request.get('/tts/..%2F..%2Fetc%2Fpasswd', {});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Invalid id' });
  });

  it('GET serves cached TTS file with correct headers', async () => {
    const { existsSync } = await import('fs');
    const mockedExistsSync = vi.mocked(existsSync);

    mockedExistsSync.mockImplementation((p: any) => {
      if (String(p).endsWith('.mp3')) return true;
      return false;
    });

    const res = await harness.request.get('/tts/test-message-id', {});

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Content-Length')).toBe('1234');
  });
});
