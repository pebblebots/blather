import { randomUUID } from 'node:crypto';
import { apiKeys } from '@blather/db';
import { createApp } from '../app.js';
import { hashApiKey, signToken } from '../middleware/auth.js';
import { createRateLimitStore } from '../middleware/rate-limit.js';
import type { TestDatabase } from './testDb.js';

type QueryValue = string | number | boolean | null | undefined;

export type RequestOptions = {
  headers?: HeadersInit;
  query?: Record<string, QueryValue>;
  body?: BodyInit;
  json?: unknown;
};

export type TestResponse<T = unknown> = {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  body: T | null;
  raw: Response;
};

export type TestRequestClient = {
  request<T = unknown>(method: string, path: string, options?: RequestOptions): Promise<TestResponse<T>>;
  get<T = unknown>(path: string, options?: RequestOptions): Promise<TestResponse<T>>;
  post<T = unknown>(path: string, options?: RequestOptions): Promise<TestResponse<T>>;
  put<T = unknown>(path: string, options?: RequestOptions): Promise<TestResponse<T>>;
  patch<T = unknown>(path: string, options?: RequestOptions): Promise<TestResponse<T>>;
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<TestResponse<T>>;
};

export type ApiTestHarness = {
  app: ReturnType<typeof createApp>;
  db: TestDatabase['db'];
  sql: TestDatabase['sql'];
  factories: TestDatabase['factories'];
  request: TestRequestClient;
  tokens: {
    jwtForUser(userId: string): string;
    apiKeyForUser(userId: string, name?: string): Promise<string>;
  };
  headers: {
    bearer(token: string): HeadersInit;
    forUser(userId: string): HeadersInit;
    apiKey(apiKey: string): HeadersInit;
    forApiKeyUser(userId: string, name?: string): Promise<HeadersInit>;
  };
  reset(): Promise<void>;
  close(): Promise<void>;
};

function withQuery(path: string, query?: Record<string, QueryValue>): string {
  if (!query) {
    return path;
  }

  const baseUrl = new URL(path, 'http://localhost');
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    baseUrl.searchParams.set(key, String(value));
  }

  return `${baseUrl.pathname}${baseUrl.search}`;
}

async function parseResponse<T>(response: Response): Promise<TestResponse<T>> {
  const text = await response.text();
  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const body = isJson && text.length > 0 ? (JSON.parse(text) as T) : null;

  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    text,
    body,
    raw: response,
  };
}

function createRequestClient(app: ReturnType<typeof createApp>): TestRequestClient {
  const request = async <T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<TestResponse<T>> => {
    const targetPath = withQuery(path, options.query);
    const headers = new Headers(options.headers);
    const init: RequestInit = { method, headers };

    if (options.json !== undefined) {
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      init.body = JSON.stringify(options.json);
    } else if (options.body !== undefined) {
      init.body = options.body;
    }

    const response = await app.request(targetPath, init);
    return parseResponse<T>(response);
  };

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, options) => request('POST', path, options),
    put: (path, options) => request('PUT', path, options),
    patch: (path, options) => request('PATCH', path, options),
    delete: (path, options) => request('DELETE', path, options),
  };
}

export function createApiTestHarness(testDatabase: TestDatabase): ApiTestHarness {
  const rateLimitStore = createRateLimitStore();
  const app = createApp(testDatabase.db, rateLimitStore);
  const request = createRequestClient(app);

  const jwtForUser = (userId: string): string => signToken(userId);

  const apiKeyForUser = async (userId: string, name = 'Test API key'): Promise<string> => {
    const rawKey = `blather_test_${randomUUID().replaceAll('-', '')}`;
    await testDatabase.db.insert(apiKeys).values({
      userId,
      keyHash: hashApiKey(rawKey),
      name,
    });
    return rawKey;
  };

  const bearer = (token: string): HeadersInit => ({ Authorization: `Bearer ${token}` });
  const forUser = (userId: string): HeadersInit => bearer(jwtForUser(userId));
  const apiKeyHeader = (apiKey: string): HeadersInit => ({ 'X-API-Key': apiKey });
  const forApiKeyUser = async (userId: string, name?: string): Promise<HeadersInit> => {
    const apiKey = await apiKeyForUser(userId, name);
    return apiKeyHeader(apiKey);
  };

  return {
    app,
    db: testDatabase.db,
    sql: testDatabase.sql,
    factories: testDatabase.factories,
    request,
    tokens: {
      jwtForUser,
      apiKeyForUser,
    },
    headers: {
      bearer,
      forUser,
      apiKey: apiKeyHeader,
      forApiKeyUser,
    },
    reset: () => { rateLimitStore.clear(); return testDatabase.reset(); },
    close: () => { rateLimitStore.destroy(); return testDatabase.close(); },
  };
}
