import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createRateLimitStore, rateLimit, type RateLimitStore } from './rate-limit.js';

function createTestApp(options: { max: number; windowMs: number; store: RateLimitStore; keyFn?: Parameters<typeof rateLimit>[0]['keyFn']; label?: string }) {
  const app = new Hono();
  app.use('*', rateLimit(options));
  app.get('/test', (c) => c.json({ ok: true }));
  app.post('/test', (c) => c.json({ ok: true }));
  return app;
}

function req(app: Hono, path = '/test', ip = '1.2.3.4') {
  return app.request(path, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('rate-limit middleware', () => {
  let store: ReturnType<typeof createRateLimitStore>;

  beforeEach(() => {
    store = createRateLimitStore(60_000);
  });

  afterEach(() => {
    store.destroy();
  });

  it('allows requests within the limit', async () => {
    const app = createTestApp({ max: 3, windowMs: 60_000, store });

    for (let i = 0; i < 3; i++) {
      const res = await req(app);
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 when limit is exceeded', async () => {
    const app = createTestApp({ max: 2, windowMs: 60_000, store });

    await req(app);
    await req(app);
    const res = await req(app);

    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/too many requests/i);
  });

  it('includes Retry-After header on 429', async () => {
    const app = createTestApp({ max: 1, windowMs: 60_000, store });

    await req(app);
    const res = await req(app);

    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
  });

  it('tracks different IPs independently', async () => {
    const app = createTestApp({ max: 1, windowMs: 60_000, store });

    const res1 = await req(app, '/test', '10.0.0.1');
    expect(res1.status).toBe(200);

    const res2 = await req(app, '/test', '10.0.0.2');
    expect(res2.status).toBe(200);

    // First IP is now blocked
    const res3 = await req(app, '/test', '10.0.0.1');
    expect(res3.status).toBe(429);

    // Second IP is also blocked
    const res4 = await req(app, '/test', '10.0.0.2');
    expect(res4.status).toBe(429);
  });

  it('resets after the window expires', async () => {
    vi.useFakeTimers();
    try {
      const app = createTestApp({ max: 1, windowMs: 10_000, store });

      const res1 = await req(app);
      expect(res1.status).toBe(200);

      const res2 = await req(app);
      expect(res2.status).toBe(429);

      // Advance past the window
      vi.advanceTimersByTime(11_000);

      const res3 = await req(app);
      expect(res3.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses custom keyFn for per-user limiting', async () => {
    const app = new Hono<{ Variables: { userId: string } }>();
    // Simulate auth setting userId
    app.use('*', async (c, next) => {
      c.set('userId', c.req.header('x-user-id') || 'anon');
      await next();
    });
    app.use('*', rateLimit({
      max: 2,
      windowMs: 60_000,
      keyFn: (c) => `user:${c.get('userId')}`,
      store,
    }));
    app.get('/test', (c) => c.json({ ok: true }));

    // User A makes 2 requests — ok
    for (let i = 0; i < 2; i++) {
      const res = await app.request('/test', { headers: { 'x-user-id': 'user-a' } });
      expect(res.status).toBe(200);
    }

    // User A is blocked
    const blocked = await app.request('/test', { headers: { 'x-user-id': 'user-a' } });
    expect(blocked.status).toBe(429);

    // User B is still allowed
    const resB = await app.request('/test', { headers: { 'x-user-id': 'user-b' } });
    expect(resB.status).toBe(200);
  });

  it('store cleanup removes expired entries', async () => {
    vi.useFakeTimers();
    try {
      const cleanupStore = createRateLimitStore(100);
      cleanupStore.set('test-key', { count: 5, resetAt: Date.now() - 1 });

      // Trigger cleanup
      vi.advanceTimersByTime(150);

      expect(cleanupStore.get('test-key')).toBeUndefined();
      cleanupStore.destroy();
    } finally {
      vi.useRealTimers();
    }
  });


  it('bypasses all rate limits when DISABLE_RATE_LIMIT=true', async () => {
    const original = process.env.DISABLE_RATE_LIMIT;
    process.env.DISABLE_RATE_LIMIT = 'true';
    try {
      const store = createRateLimitStore();
      const app = new Hono();
      app.use('/test', rateLimit({ max: 2, windowMs: 60_000, store }));
      app.get('/test', (c) => c.text('ok'));

      // Far exceeding the max of 2 should still be 200 when bypass is on
      for (let i = 0; i < 10; i++) {
        const res = await app.request('/test', { headers: { 'x-forwarded-for': '1.1.1.1' } });
        expect(res.status).toBe(200);
      }
    } finally {
      if (original === undefined) delete process.env.DISABLE_RATE_LIMIT;
      else process.env.DISABLE_RATE_LIMIT = original;
    }
  });
});