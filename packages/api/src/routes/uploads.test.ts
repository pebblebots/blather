import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

const describeWithTestDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithTestDatabase('upload routes', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function authedHeaders() {
    const user = await harness.factories.createUser();
    return harness.headers.forUser(user.id);
  }

  // ── Upload file ──

  it('POST /uploads creates a file and returns URL', async () => {
    const headers = await authedHeaders();

    const formData = new FormData();
    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });
    formData.append('file', file);

    // Use raw fetch against the app since harness.request.post sends JSON
    const app = harness.app;
    const res = await app.request('/uploads', {
      method: 'POST',
      headers: { Authorization: headers.Authorization },
      body: formData,
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.url).toMatch(/^\/uploads\/.+\.txt$/);
    expect(body.filename).toBe('test.txt');
    expect(body.contentType).toBe('text/plain');
    expect(body.size).toBe(11);
  });

  it('POST /uploads rejects disallowed content types', async () => {
    const headers = await authedHeaders();

    const formData = new FormData();
    const file = new File(['#!/bin/bash'], 'script.sh', { type: 'application/x-sh' });
    formData.append('file', file);

    const app = harness.app;
    const res = await app.request('/uploads', {
      method: 'POST',
      headers: { Authorization: headers.Authorization },
      body: formData,
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Content type not allowed');
  });

  it('POST /uploads rejects request without file', async () => {
    const headers = await authedHeaders();

    const formData = new FormData();
    formData.append('file', '');

    const app = harness.app;
    const res = await app.request('/uploads', {
      method: 'POST',
      headers: { Authorization: headers.Authorization },
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  // ── Serve files ──

  it('GET /uploads/:filename returns 404 for nonexistent file', async () => {
    const res = await harness.request.get('/uploads/nonexistent.txt', {
      headers: await authedHeaders(),
    });

    expect(res.status).toBe(404);
  });

  it('GET /uploads/:filename rejects path traversal', async () => {
    const res = await harness.request.get('/uploads/..%2F..%2Fetc%2Fpasswd', {
      headers: await authedHeaders(),
    });

    expect(res.status).toBe(400);
  });

  // ── TTS file serving ──

  it('GET /uploads/tts/:filename returns 404 for nonexistent TTS file', async () => {
    const res = await harness.request.get('/uploads/tts/nonexistent.mp3', {
      headers: await authedHeaders(),
    });

    expect(res.status).toBe(404);
  });

  it('GET /uploads/tts/:filename rejects path traversal', async () => {
    const res = await harness.request.get('/uploads/tts/..%2F..%2Fetc%2Fpasswd', {
      headers: await authedHeaders(),
    });

    expect(res.status).toBe(400);
  });

  // ── Upload + serve round-trip ──

  it('uploaded file can be retrieved via GET', async () => {
    const headers = await authedHeaders();

    const formData = new FormData();
    const content = 'round trip test content';
    const file = new File([content], 'roundtrip.txt', { type: 'text/plain' });
    formData.append('file', file);

    const app = harness.app;
    const uploadRes = await app.request('/uploads', {
      method: 'POST',
      headers: { Authorization: headers.Authorization },
      body: formData,
    });

    expect(uploadRes.status).toBe(201);
    const uploadBody = await uploadRes.json() as any;

    // Now fetch the uploaded file
    const getRes = await app.request(uploadBody.url, { method: 'GET' });

    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('text/plain');
    const text = await getRes.text();
    expect(text).toBe(content);
  });
});
