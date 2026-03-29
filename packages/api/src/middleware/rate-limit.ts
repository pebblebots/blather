import { createMiddleware } from 'hono/factory';
import type { Env } from '../app.js';

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitStore = {
  get(key: string): RateLimitEntry | undefined;
  set(key: string, entry: RateLimitEntry): void;
  delete(key: string): void;
  clear(): void;
};

/**
 * In-memory rate limit store with periodic TTL cleanup.
 */
export function createRateLimitStore(cleanupIntervalMs = 60_000): RateLimitStore & { destroy(): void } {
  const map = new Map<string, RateLimitEntry>();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of map) {
      if (entry.resetAt <= now) {
        map.delete(key);
      }
    }
  }, cleanupIntervalMs);
  timer.unref();

  return {
    get: (key) => map.get(key),
    set: (key, entry) => map.set(key, entry),
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    destroy: () => clearInterval(timer),
  };
}


function getClientIp(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown';
}

export type RateLimitOptions = {
  /** Maximum number of requests allowed in the window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Key function — return a string identifying the client. */
  keyFn?: (c: { req: { header(name: string): string | undefined }; get(key: 'userId'): string }) => string;
  /** Optional store override (useful for testing). */
  store?: RateLimitStore;
  /** Label for log messages. */
  label?: string;
};

/**
 * Creates a Hono middleware that enforces rate limits.
 * Returns 429 with Retry-After header when the limit is exceeded.
 */
export function rateLimit(options: RateLimitOptions) {
  const { max, windowMs, label = 'rate-limit' } = options;
  const keyFn = options.keyFn ?? ((c) => `ip:${getClientIp(c)}`);
  const ownStore = options.store ?? createRateLimitStore();

  return createMiddleware<Env>(async (c, next) => {
    const store = ownStore;
    const key = `${label}:${keyFn(c as never)}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      const ip = getClientIp(c);
      console.warn(`[RATE LIMIT] ${label} exceeded for key=${key} ip=${ip} path=${c.req.path}`);
      return c.json(
        { error: 'Too many requests, please try again later' },
        429 as any,
        { 'Retry-After': String(retryAfter) },
      );
    }

    await next();
  });
}

// ── Pre-configured rate limiters ──

/** Auth: magic link requests — 5 per 15 min per IP */
export function authMagicLimiter(store?: RateLimitStore) {
  return rateLimit({
    max: 5,
    windowMs: 15 * 60 * 1000,
    label: 'auth-magic',
    store,
  });
}

/** Auth: code/token verification — 10 per 15 min per IP */
export function authVerifyLimiter(store?: RateLimitStore) {
  return rateLimit({
    max: 10,
    windowMs: 15 * 60 * 1000,
    label: 'auth-verify',
    store,
  });
}

function userOrIpKey(c: { req: { header(name: string): string | undefined }; get(key: 'userId'): string }): string {
  try {
    const userId = c.get('userId');
    if (userId) return `user:${userId}`;
  } catch { /* userId not set yet — fall back to IP */ }
  return `ip:${getClientIp(c as never)}`;
}

/** General API — 100 per minute per user */
export function generalApiLimiter(store?: RateLimitStore) {
  return rateLimit({
    max: 100,
    windowMs: 60 * 1000,
    keyFn: userOrIpKey,
    label: 'api-general',
    store,
  });
}

/** Message sending — 30 per minute per user */
export function messageSendLimiter(store?: RateLimitStore) {
  return rateLimit({
    max: 30,
    windowMs: 60 * 1000,
    keyFn: userOrIpKey,
    label: 'api-messages',
    store,
  });
}

/** File uploads — 10 per minute per user */
export function uploadLimiter(store?: RateLimitStore) {
  return rateLimit({
    max: 10,
    windowMs: 60 * 1000,
    keyFn: userOrIpKey,
    label: 'api-uploads',
    store,
  });
}
