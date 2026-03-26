import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

describe('upload routes', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;
  let authHeaders: HeadersInit;
  const uploadDir = process.env.BLATHER_UPLOAD_DIR!;
  const ttsDir = process.env.BLATHER_TTS_DIR!;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  beforeEach(async () => {
    await harness.reset();
    await rm(uploadDir, { recursive: true, force: true });
    await rm(ttsDir, { recursive: true, force: true });
    await mkdir(uploadDir, { recursive: true });
    await mkdir(ttsDir, { recursive: true });
    const user = await harness.factories.createUser();
    authHeaders = harness.headers.forUser(user.id);
  });

  afterAll(async () => {
    await harness.close();
    await rm(uploadDir, { recursive: true, force: true });
    await rm(ttsDir, { recursive: true, force: true });
  });

  // Upload helper — uses app.request directly because harness.request
  // parses response as text, which is fine for JSON but we want the raw
  // Response for consistency with multipart POST.
  async function uploadFile(filename: string, content: string, type = 'text/plain') {
    const formData = new FormData();
    formData.append('file', new File([content], filename, { type }));
    return harness.app.request('/uploads', {
      method: 'POST',
      headers: { Authorization: (authHeaders as Record<string, string>).Authorization },
      body: formData,
    });
  }

  // ── Upload file ──

  it('POST /uploads creates a file and returns URL', async () => {
    const res = await uploadFile('test.txt', 'hello world');

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.url).toMatch(/^\/uploads\/.+\.txt$/);
    expect(body.filename).toBe('test.txt');
    expect(body.contentType).toBe('text/plain');
    expect(body.size).toBe(11);

    const files = await readdir(uploadDir);
    expect(files).toHaveLength(1);
  });

  it('POST /uploads rejects unauthenticated requests', async () => {
    const formData = new FormData();
    formData.append('file', new File(['hello'], 'test.txt', { type: 'text/plain' }));

    const res = await harness.app.request('/uploads', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(401);
  });

  it('POST /uploads rejects disallowed content types', async () => {
    const formData = new FormData();
    formData.append('file', new File(['#!/bin/bash'], 'script.sh', { type: 'application/x-sh' }));

    const res = await harness.app.request('/uploads', {
      method: 'POST',
      headers: { Authorization: (authHeaders as Record<string, string>).Authorization },
      body: formData,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, string>;
    expect(body.error).toContain('Content type not allowed');
  });

  it('POST /uploads rejects request with empty string instead of file', async () => {
    const formData = new FormData();
    formData.append('file', '');

    const res = await harness.app.request('/uploads', {
      method: 'POST',
      headers: { Authorization: (authHeaders as Record<string, string>).Authorization },
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  it('POST /uploads rejects request with no file field', async () => {
    const formData = new FormData();

    const res = await harness.app.request('/uploads', {
      method: 'POST',
      headers: { Authorization: (authHeaders as Record<string, string>).Authorization },
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  it('POST /uploads rejects files exceeding 25MB', async () => {
    const oversized = 'x'.repeat(25 * 1024 * 1024 + 1);

    const res = await uploadFile('big.txt', oversized);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, string>;
    expect(body.error).toContain('File too large');
  });

  // ── Serve uploaded files (no auth required) ──

  it('GET /uploads/:filename returns 404 for nonexistent file', async () => {
    const res = await harness.request.get('/uploads/nonexistent.txt');

    expect(res.status).toBe(404);
  });

  it('GET /uploads/:filename rejects path traversal', async () => {
    const res = await harness.request.get('/uploads/..%2F..%2Fetc%2Fpasswd');

    expect(res.status).toBe(400);
  });

  // ── TTS file serving (no auth required) ──

  it('GET /uploads/tts/:filename returns 404 for nonexistent TTS file', async () => {
    const res = await harness.request.get('/uploads/tts/nonexistent.mp3');

    expect(res.status).toBe(404);
  });

  it('GET /uploads/tts/:filename rejects path traversal', async () => {
    const res = await harness.request.get('/uploads/tts/..%2F..%2Fetc%2Fpasswd');

    expect(res.status).toBe(400);
  });

  it('GET /uploads/tts/:filename serves files from the TTS directory', async () => {
    await writeFile(join(ttsDir, 'sample.mp3'), Buffer.from('fake-mp3-data'));

    // Use app.request directly to check binary response and Content-Type header
    const res = await harness.app.request('/uploads/tts/sample.mp3', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from('fake-mp3-data'));
  });

  // ── Upload + serve round-trip ──

  it('uploaded file can be retrieved via GET', async () => {
    const content = 'round trip test content';
    const uploadRes = await uploadFile('roundtrip.txt', content);
    expect(uploadRes.status).toBe(201);
    const uploadBody = (await uploadRes.json()) as Record<string, unknown>;

    const getRes = await harness.app.request(uploadBody.url as string, { method: 'GET' });

    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('text/plain');
    expect(await getRes.text()).toBe(content);
  });
});
