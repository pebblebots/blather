import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import { users } from '@blather/db';
import { createApiTestHarness } from '../test/apiHarness.js';
import { createTestDatabase, type TestDatabase } from '../test/testDb.js';
import { __testing, getPresence } from '../ws/manager.js';

class ConnectedSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  closeCode: number | null = null;
  closeReason: string | null = null;

  send() {}

  close(code: number, reason: string) {
    this.readyState = WebSocket.CLOSED;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit('close', code, Buffer.from(reason));
  }
}

describe('member deactivation', () => {
  let testDatabase: TestDatabase;
  let harness: ReturnType<typeof createApiTestHarness>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    harness = createApiTestHarness(testDatabase);
  });

  afterAll(async () => {
    __testing.resetState();
    await harness.close();
  });

  it('disconnects existing WebSocket sessions after deactivation succeeds', async () => {
    const owner = await harness.factories.createUser({ email: 'owner@example.com' });
    await harness.db.update(users).set({ role: 'owner' }).where(eq(users.id, owner.id));
    const target = await harness.factories.createUser({ email: 'target@example.com' });
    const socket = new ConnectedSocket();
    __testing.setupAuthedClient(socket as any, target.id);

    const response = await harness.request.patch(`/members/${target.id}/deactivate`, {
      headers: harness.headers.forUser(owner.id),
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: target.id });
    expect(socket.closeCode).toBe(4003);
    expect(socket.closeReason).toBe('Account deactivated');
    expect(getPresence()).not.toContainEqual(expect.objectContaining({ userId: target.id }));
  });
});
