import { describe, it, expect, vi, afterEach } from 'vitest';

/*
 * urls.ts evaluates API_BASE_URL at import time using import.meta.env,
 * so we must set up the env mock BEFORE each dynamic import. Each test
 * uses vi.resetModules() + dynamic import to get a fresh evaluation.
 *
 * Note: vitest always sets import.meta.env.DEV = true, so the
 * "production with no VITE_API_URL" path (API_BASE_URL = '') cannot be
 * reached here. Those branches are exercised indirectly through the
 * Vite build and verified by the function-level tests below.
 */

/** Helper: dynamically import urls.ts with a fresh module evaluation. */
async function loadUrls(viteApiUrl?: string) {
  if (viteApiUrl !== undefined) {
    vi.stubEnv('VITE_API_URL', viteApiUrl);
  }
  vi.resetModules();
  return import('./urls.js');
}

describe('urls', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // ── API_BASE_URL resolution ──

  describe('API_BASE_URL', () => {
    it('uses VITE_API_URL when set with protocol', async () => {
      const { API_BASE_URL } = await loadUrls('http://custom:4000');
      expect(API_BASE_URL).toBe('http://custom:4000');
    });

    it('strips trailing slashes from configured URL', async () => {
      const { API_BASE_URL } = await loadUrls('http://custom:4000///');
      expect(API_BASE_URL).toBe('http://custom:4000');
    });

    it('prepends http to bare hostnames in non-https context', async () => {
      // jsdom default protocol is http:, so bare hostnames get http://
      const { API_BASE_URL } = await loadUrls('api.test:3000');
      expect(API_BASE_URL).toBe('http://api.test:3000');
    });

    it('trims whitespace from configured URL', async () => {
      const { API_BASE_URL } = await loadUrls('  http://trimmed:3000  ');
      expect(API_BASE_URL).toBe('http://trimmed:3000');
    });

    it('falls back to default dev URL when VITE_API_URL is empty', async () => {
      // In vitest (DEV=true), empty VITE_API_URL -> http://localhost:3000
      const { API_BASE_URL } = await loadUrls('');
      expect(API_BASE_URL).toBe('http://localhost:3000');
    });

    it('falls back to default dev URL when VITE_API_URL is not set', async () => {
      // undefined VITE_API_URL follows the same fallback path as empty string
      const { API_BASE_URL } = await loadUrls();
      expect(API_BASE_URL).toBe('http://localhost:3000');
    });
  });

  // ── apiUrl ──

  describe('apiUrl', () => {
    it('returns absolute URLs unchanged', async () => {
      const { apiUrl } = await loadUrls('http://api.test:3000');
      expect(apiUrl('https://cdn.example.com/file.png')).toBe('https://cdn.example.com/file.png');
    });

    it('preserves non-http protocols as absolute', async () => {
      const { apiUrl } = await loadUrls('http://api.test:3000');
      expect(apiUrl('ftp://files.example.com/data')).toBe('ftp://files.example.com/data');
    });

    it('prepends API_BASE_URL to paths with leading slash', async () => {
      const { apiUrl } = await loadUrls('http://api.test:3000');
      expect(apiUrl('/workspaces')).toBe('http://api.test:3000/workspaces');
    });

    it('adds leading slash to bare paths', async () => {
      const { apiUrl } = await loadUrls('http://api.test:3000');
      expect(apiUrl('workspaces')).toBe('http://api.test:3000/workspaces');
    });

    it('handles paths with query strings', async () => {
      const { apiUrl } = await loadUrls('http://api.test:3000');
      expect(apiUrl('/messages?limit=20')).toBe('http://api.test:3000/messages?limit=20');
    });
  });

  // ── wsUrl ──

  describe('wsUrl', () => {
    it('converts http base URL to ws protocol', async () => {
      const { wsUrl } = await loadUrls('http://api.test:3000');
      expect(wsUrl('/ws/events')).toBe('ws://api.test:3000/ws/events');
    });

    it('converts https base URL to wss protocol', async () => {
      const { wsUrl } = await loadUrls('https://api.prod.com');
      expect(wsUrl('/ws/events')).toBe('wss://api.prod.com/ws/events');
    });

    it('adds leading slash to bare paths', async () => {
      const { wsUrl } = await loadUrls('http://localhost:3000');
      expect(wsUrl('ws/events')).toBe('ws://localhost:3000/ws/events');
    });

    it('preserves port in the WebSocket URL', async () => {
      const { wsUrl } = await loadUrls('http://localhost:8080');
      expect(wsUrl('/ws')).toBe('ws://localhost:8080/ws');
    });
  });
});
