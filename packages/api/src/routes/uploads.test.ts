import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';

describe('upload routes', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;
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
  });

  afterAll(async () => {
    await harness.close();
  });

  async function authedHeaders() {
    const user = await harness.factories.createUser();
    return harness.headers.forUser(user.id);
  }

  async function uploadTextFile(filename: string, content: string) {
    const headers = await authedHeaders();
    const formData = new FormData();

    formData.append('file', new File([content], filename, { type: 'text/plain' }));

    return harness.app.request('/uploads', {
      method: 'POST',
      headers: { Authorization: headers.Authorization },
      body: formData,
    });
  }

  // ── Upload file ──

  it('POST /uploads creates a file and returns URL', async () => {
    const res = await uploadTextFile('test.txt', 'hello world');

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.url).toMatch(/^\/uploads\/.+\.txt$/);
    expect(body.filename).toBe('test.txt');
    expect(body.contentType).toBe('text/plain');
    expect(body.size).toBe(11);

    const files = await readdir(uploadDir);
    expect(files).toHaveLength(1);
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

  it('GET /uploads/tts/:filename serves files from the TTS directory', async () => {
    await writeFile(join(ttsDir, 'sample.mp3'), Buffer.from('fake-mp3-data'));

    const res = await harness.app.request('/uploads/tts/sample.mp3', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from('fake-mp3-data'));
  });

  // ── Upload + serve round-trip ──

  it('uploaded file can be retrieved via GET', async () => {
    const content = 'round trip test content';
    const uploadRes = await uploadTextFile('roundtrip.txt', content);

    expect(uploadRes.status).toBe(201);
    const uploadBody = await uploadRes.json() as any;

    // Now fetch the uploaded file
    const getRes = await harness.app.request(uploadBody.url, { method: 'GET' });

    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('text/plain');
    const text = await getRes.text();
    expect(text).toBe(content);
  });
});
