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

import { __testing, getPresenceForWorkspace, publishEvent, publishEphemeralEvent } from './manager.js';
import { JWT_SECRET } from '../config.js';

let testCounter = 0;

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

function createAuthedClient(userId: string, workspaceId: string): FakeWebSocket {
  const ws = new FakeWebSocket();
  __testing.setupAuthedClient(ws as any, userId, workspaceId);
  return ws;
}

describe('WebSocket manager', () => {
  function uniqueWorkspaceId() {
    return `ws-${++testCounter}`;
  }

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
    const wsId = uniqueWorkspaceId();
    const ws = new FakeWebSocket();
    __testing.setupPendingClient(ws as any);

    const connected = waitForType(ws, 'connected');
    ws.clientSend({ type: 'auth', token: signToken('user-2'), workspaceId: wsId });

    await expect(connected).resolves.toEqual({ type: 'connected', userId: 'user-2', workspaceId: wsId });
  });

  it('setupPendingClient rejects invalid token in auth message (code 4003)', async () => {
    const ws = new FakeWebSocket();
    __testing.setupPendingClient(ws as any);

    const closed = waitForClose(ws);
    ws.clientSend({ type: 'auth', token: 'bad-token', workspaceId: uniqueWorkspaceId() });

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
    const wsId = uniqueWorkspaceId();
    createAuthedClient('user-p1', wsId);
    expect(getPresenceForWorkspace(wsId)).toEqual([{ userId: 'user-p1', status: 'online' }]);
  });

  it('removes presence when user disconnects', async () => {
    const wsId = uniqueWorkspaceId();
    const ws = createAuthedClient('user-p2', wsId);
    ws.close();
    expect(getPresenceForWorkspace(wsId)).toEqual([]);
  });

  it('returns empty presence for unknown workspace', () => {
    expect(getPresenceForWorkspace('nonexistent')).toEqual([]);
  });

  it('broadcasts presence.changed online when user connects', async () => {
    const wsId = uniqueWorkspaceId();
    const ws1 = createAuthedClient('user-a', wsId);
    const presencePromise = waitForType(ws1, 'presence.changed');
    createAuthedClient('user-b', wsId);
    await expect(presencePromise).resolves.toEqual({
      type: 'presence.changed',
      data: { userId: 'user-b', status: 'online' },
    });
  });

  it('broadcasts presence.changed offline when user disconnects', async () => {
    const wsId = uniqueWorkspaceId();
    const ws1 = createAuthedClient('user-c', wsId);
    const ws2 = createAuthedClient('user-d', wsId);
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
    const wsId = uniqueWorkspaceId();

    const conns = [createAuthedClient(userId, wsId), createAuthedClient(userId, wsId), createAuthedClient(userId, wsId)];
    const closePromise = waitForClose(conns[0]);
    createAuthedClient(userId, wsId);

    await expect(closePromise).resolves.toMatchObject({ code: 4008 });
  });

  it('responds to application ping with pong', async () => {
    const wsId = uniqueWorkspaceId();
    const ws = createAuthedClient('user-ping', wsId);
    const pong = waitForType(ws, 'pong');
    ws.clientSend({ type: 'ping' });
    await expect(pong).resolves.toEqual({ type: 'pong' });
  });

  it('publishEvent sends to all clients for public channel', async () => {
    const wsId = uniqueWorkspaceId();
    const ws1 = createAuthedClient('user-e1', wsId);
    const ws2 = createAuthedClient('user-e2', wsId);

    dbQueryResults = [[{ channelType: 'public' }]];
    const event = { type: 'message.created', channel_id: 'ch-1', data: { text: 'hello' } };

    const p1 = waitForType(ws1, 'message.created');
    const p2 = waitForType(ws2, 'message.created');
    await publishEvent(wsId, event);

    await expect(Promise.all([p1, p2])).resolves.toEqual([event, event]);
  });

  it('publishEvent restricts private channel events to members only', async () => {
    const wsId = uniqueWorkspaceId();
    const ws1 = createAuthedClient('user-priv1', wsId);
    const ws2 = createAuthedClient('user-priv2', wsId);

    dbQueryResults = [[{ channelType: 'private' }], [{ userId: 'user-priv1' }]];

    const event = { type: 'message.created', channel_id: 'ch-priv', data: { text: 'secret' } };
    const p1 = waitForType(ws1, 'message.created');
    await publishEvent(wsId, event);

    await expect(p1).resolves.toEqual(event);
    expect(ws2.sent.some((message) => message.type === 'message.created')).toBe(false);
  });

  it('publishEvent restricts DM channel events to members only', async () => {
    const wsId = uniqueWorkspaceId();
    const ws1 = createAuthedClient('user-dm1', wsId);
    const ws2 = createAuthedClient('user-dm2', wsId);

    dbQueryResults = [[{ channelType: 'dm' }], [{ userId: 'user-dm1' }]];

    const event = { type: 'message.created', channel_id: 'ch-dm', data: { text: 'hi' } };
    const p1 = waitForType(ws1, 'message.created');
    await publishEvent(wsId, event);

    await expect(p1).resolves.toEqual(event);
    expect(ws2.sent.some((message) => message.type === 'message.created')).toBe(false);
  });

  it('publishEvent sends to all when no channel_id', async () => {
    const wsId = uniqueWorkspaceId();
    const ws = createAuthedClient('user-noc', wsId);
    const event = { type: 'workspace.updated', data: { name: 'new' } };

    const received = waitForType(ws, 'workspace.updated');
    await publishEvent(wsId, event);

    await expect(received).resolves.toEqual(event);
  });

  it('publishEvent is a no-op for unknown workspace', async () => {
    await expect(publishEvent('nonexistent', { type: 'test' })).resolves.toBeUndefined();
  });

  it('publishEphemeralEvent broadcasts to all workspace clients', async () => {
    const wsId = uniqueWorkspaceId();
    const ws1 = createAuthedClient('user-eph1', wsId);
    const ws2 = createAuthedClient('user-eph2', wsId);

    const event = { type: 'typing', channelId: 'ch-1', userId: 'user-eph1' };
    const p1 = waitForType(ws1, 'typing');
    const p2 = waitForType(ws2, 'typing');
    await publishEphemeralEvent(wsId, event);

    await expect(Promise.all([p1, p2])).resolves.toEqual([event, event]);
  });

  it('publishEphemeralEvent is a no-op for unknown workspace', async () => {
    await expect(publishEphemeralEvent('nonexistent', { type: 'typing' })).resolves.toBeUndefined();
  });
});
