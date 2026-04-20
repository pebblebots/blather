import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';

let dbQueryResults: any[][] = [];
let dbQueryIndex = 0;

vi.mock('@blather/db', () => {
  const makeChain = (): any => {
    const self: any = {};
    self.from = () => self;
    self.where = () => self;
    self.limit = () => self;
    self.then = (resolve: any, reject?: any) => {
      const result = dbQueryResults[dbQueryIndex] ?? [];
      dbQueryIndex++;
      return Promise.resolve(result).then(resolve, reject);
    };
    return self;
  };

  return {
    createDb: () => ({ select: () => makeChain() }),
    apiKeys: { keyHash: 'keyHash', revokedAt: 'revokedAt', userId: 'userId' },
    channels: { id: 'id', channelType: 'channelType' },
    channelMembers: { channelId: 'channelId', userId: 'userId' },
  };
});

import { __testing, getPresence, publishEvent, publishEphemeralEvent } from './manager.js';
import { JWT_SECRET } from '../config.js';

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '1h' });
}

class FakeWebSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: any[] = [];
  pingCount = 0;

  send(data: string) {
    const parsed = JSON.parse(data);
    this.sent.push(parsed);
    this.emit('server-message', parsed);
  }

  clientSend(payload: Record<string, unknown>) {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
  }

  ping() {
    this.pingCount += 1;
  }

  close(code = 1000, reason = '') {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }

  terminate() {
    this.close(1006, 'terminated');
  }
}

function waitForType(ws: FakeWebSocket, type: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('server-message', handler);
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeoutMs);
    function handler(message: any) {
      if (message.type === type) {
        clearTimeout(timer);
        ws.off('server-message', handler);
        resolve(message);
      }
    }
    ws.on('server-message', handler);
  });
}

function waitForClose(ws: FakeWebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for WS close')), 3000);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function createAuthedClient(userId: string): FakeWebSocket {
  const ws = new FakeWebSocket();
  __testing.setupAuthedClient(ws as any, userId);
  return ws;
}

describe('WebSocket manager', () => {
  beforeEach(() => {
    dbQueryResults = [];
    dbQueryIndex = 0;
    __testing.resetState();
  });

  it('verifyToken returns user id for a valid JWT', () => {
    expect(__testing.verifyToken(signToken('user-1'))).toBe('user-1');
  });

  it('verifyToken rejects invalid JWT token', () => {
    expect(__testing.verifyToken('invalid-token')).toBeNull();
  });

  it('setupPendingClient authenticates via auth message', async () => {
    const ws = new FakeWebSocket();
    __testing.setupPendingClient(ws as any);

    const connected = waitForType(ws, 'connected');
    ws.clientSend({ type: 'auth', token: signToken('user-2') });

    await expect(connected).resolves.toEqual({ type: 'connected', userId: 'user-2' });
  });

  it('setupPendingClient rejects invalid token in auth message (code 4003)', async () => {
    const ws = new FakeWebSocket();
    __testing.setupPendingClient(ws as any);

    const closed = waitForClose(ws);
    ws.clientSend({ type: 'auth', token: 'bad-token' });

    await expect(closed).resolves.toMatchObject({ code: 4003 });
  });

  it('setupPendingClient rejects auth message with missing fields (code 4002)', async () => {
    const ws = new FakeWebSocket();
    __testing.setupPendingClient(ws as any);

    const closed = waitForClose(ws);
    ws.clientSend({ type: 'auth' });

    await expect(closed).resolves.toMatchObject({ code: 4002 });
  });

  it('resolveApiKeyUserId returns user id for a valid API key', async () => {
    dbQueryResults = [[{ userId: 'user-api', keyHash: 'h', revokedAt: null }]];
    await expect(__testing.resolveApiKeyUserId('blather_test123')).resolves.toBe('user-api');
  });

  it('resolveApiKeyUserId returns null for invalid API key', async () => {
    dbQueryResults = [[]];
    await expect(__testing.resolveApiKeyUserId('blather_bad')).resolves.toBeNull();
  });

  it('tracks online presence for connected user', () => {
    createAuthedClient('user-p1');
    expect(getPresence()).toEqual([{ userId: 'user-p1', status: 'online' }]);
  });

  it('removes presence when user disconnects', async () => {
    const ws = createAuthedClient('user-p2');
    ws.close();
    expect(getPresence()).toEqual([]);
  });

  it('returns empty presence when no clients connected', () => {
    expect(getPresence()).toEqual([]);
  });

  it('broadcasts presence.changed online when user connects', async () => {
    const ws1 = createAuthedClient('user-a');
    const presencePromise = waitForType(ws1, 'presence.changed');
    createAuthedClient('user-b');
    await expect(presencePromise).resolves.toEqual({
      type: 'presence.changed',
      data: { userId: 'user-b', status: 'online' },
    });
  });

  it('broadcasts presence.changed offline when user disconnects', async () => {
    const ws1 = createAuthedClient('user-c');
    const ws2 = createAuthedClient('user-d');
    expect(ws1.sent).toContainEqual({
      type: 'presence.changed',
      data: { userId: 'user-d', status: 'online' },
    });

    const offlinePromise = waitForType(ws1, 'presence.changed');
    ws2.close();

    await expect(offlinePromise).resolves.toEqual({
      type: 'presence.changed',
      data: { userId: 'user-d', status: 'offline' },
    });
  });

  it('enforces max 3 connections per user (closes oldest)', async () => {
    const userId = 'user-max';

    const conns = [createAuthedClient(userId), createAuthedClient(userId), createAuthedClient(userId)];
    const closePromise = waitForClose(conns[0]);
    createAuthedClient(userId);

    await expect(closePromise).resolves.toMatchObject({ code: 4008 });
  });

  it('responds to application ping with pong', async () => {
    const ws = createAuthedClient('user-ping');
    const pong = waitForType(ws, 'pong');
    ws.clientSend({ type: 'ping' });
    await expect(pong).resolves.toEqual({ type: 'pong' });
  });

  // T#156: public channel fanout is now gated by membership too.
  it('publishEvent sends to members only for public channel (T#156)', async () => {
    const ws1 = createAuthedClient('user-e1');
    const ws2 = createAuthedClient('user-e2');

    // Single query now: just the members lookup. Only user-e1 is a member.
    dbQueryResults = [[{ userId: 'user-e1' }]];
    const event = { type: 'message.created', channel_id: 'ch-1', data: { text: 'hello' } };

    const p1 = waitForType(ws1, 'message.created');
    await publishEvent(event);

    await expect(p1).resolves.toEqual(event);
    expect(ws2.sent.some((message) => message.type === 'message.created')).toBe(false);
  });

  it('publishEvent restricts private channel events to members only', async () => {
    const ws1 = createAuthedClient('user-priv1');
    const ws2 = createAuthedClient('user-priv2');

    dbQueryResults = [[{ userId: 'user-priv1' }]];

    const event = { type: 'message.created', channel_id: 'ch-priv', data: { text: 'secret' } };
    const p1 = waitForType(ws1, 'message.created');
    await publishEvent(event);

    await expect(p1).resolves.toEqual(event);
    expect(ws2.sent.some((message) => message.type === 'message.created')).toBe(false);
  });

  it('publishEvent restricts DM channel events to members only', async () => {
    const ws1 = createAuthedClient('user-dm1');
    const ws2 = createAuthedClient('user-dm2');

    dbQueryResults = [[{ userId: 'user-dm1' }]];

    const event = { type: 'message.created', channel_id: 'ch-dm', data: { text: 'hi' } };
    const p1 = waitForType(ws1, 'message.created');
    await publishEvent(event);

    await expect(p1).resolves.toEqual(event);
    expect(ws2.sent.some((message) => message.type === 'message.created')).toBe(false);
  });

  it('publishEvent sends to all when no channel_id', async () => {
    const ws = createAuthedClient('user-noc');
    const event = { type: 'app.updated', data: { name: 'new' } };

    const received = waitForType(ws, 'app.updated');
    await publishEvent(event);

    await expect(received).resolves.toEqual(event);
  });

  it('publishEvent is a no-op when no clients connected', async () => {
    await expect(publishEvent({ type: 'test' })).resolves.toBeUndefined();
  });

  it('publishEphemeralEvent broadcasts to all clients when no channel_id', async () => {
    const ws1 = createAuthedClient('user-eph1');
    const ws2 = createAuthedClient('user-eph2');

    const event = { type: 'typing', userId: 'user-eph1' };
    const p1 = waitForType(ws1, 'typing');
    const p2 = waitForType(ws2, 'typing');
    await publishEphemeralEvent(event);

    await expect(Promise.all([p1, p2])).resolves.toEqual([event, event]);
  });

  // T#157: ephemeral events scoped to a channel (e.g. typing) are now
  // membership-gated just like persistent events.
  it('publishEphemeralEvent restricts channel-scoped events to members only (T#157)', async () => {
    const ws1 = createAuthedClient('user-eph-m');
    const ws2 = createAuthedClient('user-eph-notm');

    dbQueryResults = [[{ userId: 'user-eph-m' }]];

    const event = { type: 'typing.started', channel_id: 'ch-eph', data: { userId: 'user-eph-m' } };
    const p1 = waitForType(ws1, 'typing.started');
    await publishEphemeralEvent(event);

    await expect(p1).resolves.toEqual(event);
    expect(ws2.sent.some((message) => message.type === 'typing.started')).toBe(false);
  });

  it('publishEphemeralEvent is a no-op when no clients connected', async () => {
    await expect(publishEphemeralEvent({ type: 'typing' })).resolves.toBeUndefined();
  });
});
