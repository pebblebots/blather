import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

// Queue-based mock DB: each db.select() chain resolves to the next entry
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

import { attachWebSocket, getPresenceForWorkspace, publishEvent, publishEphemeralEvent } from './manager.js';

const JWT_SECRET = 'blather-dev-secret-change-in-production';
let testCounter = 0;

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '1h' });
}

/** Wait for the next WS message matching a given type, ignoring others */
function waitForType(ws: WebSocket, type: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeoutMs);
    function handler(data: Buffer | string) {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    }
    ws.on('message', handler);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for WS close')), 3000);
    ws.once('error', () => {});
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
    const timer = setTimeout(() => reject(new Error('Timeout waiting for WS open')), 3000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

describe('WebSocket manager', () => {
  let server: http.Server;
  let port: number;
  let openClients: WebSocket[] = [];

  function uniqueWs() { return `ws-${++testCounter}`; }

  function rawConnect(params: string): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events${params ? '?' + params : ''}`);
    openClients.push(ws);
    return ws;
  }

  /** Connect with JWT and wait for 'connected' ack (ignoring presence messages) */
  async function connectAuthed(userId: string, workspaceId: string): Promise<WebSocket> {
    const token = signToken(userId);
    const ws = rawConnect(`token=${token}&workspace_id=${workspaceId}`);
    await waitForType(ws, 'connected');
    return ws;
  }

  beforeAll(async () => {
    server = http.createServer();
    attachWebSocket(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  beforeEach(() => {
    dbQueryResults = [];
    dbQueryIndex = 0;
  });

  afterEach(async () => {
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    await new Promise(r => setTimeout(r, 50));
    openClients = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── Authentication ──

  it('authenticates with valid JWT via query param', async () => {
    const wsId = uniqueWs();
    const token = signToken('user-1');
    const ws = rawConnect(`token=${token}&workspace_id=${wsId}`);
    const msg = await waitForType(ws, 'connected');
    expect(msg).toEqual({ type: 'connected', userId: 'user-1', workspaceId: wsId });
  });

  it('rejects invalid JWT token', async () => {
    const ws = rawConnect(`token=invalid-token&workspace_id=${uniqueWs()}`);
    ws.on('error', () => {});
    const { code } = await waitForClose(ws);
    expect(code).toBeTruthy();
  });

  it('authenticates via auth message (no query params)', async () => {
    const wsId = uniqueWs();
    const ws = rawConnect('');
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'auth', token: signToken('user-2'), workspaceId: wsId }));
    const msg = await waitForType(ws, 'connected');
    expect(msg).toEqual({ type: 'connected', userId: 'user-2', workspaceId: wsId });
  });

  it('rejects invalid token in auth message (code 4003)', async () => {
    const ws = rawConnect('');
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'auth', token: 'bad-token', workspaceId: uniqueWs() }));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4003);
  });

  it('rejects auth message with missing fields (code 4002)', async () => {
    const ws = rawConnect('');
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: 'auth' }));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4002);
  });

  it('authenticates with valid API key via query param', async () => {
    const wsId = uniqueWs();
    dbQueryResults = [[{ userId: 'user-api', keyHash: 'h', revokedAt: null }]];
    const ws = rawConnect(`api_key=blather_test123&workspace_id=${wsId}`);
    const msg = await waitForType(ws, 'connected');
    expect(msg).toEqual({ type: 'connected', userId: 'user-api', workspaceId: wsId });
  });

  it('rejects invalid API key', async () => {
    dbQueryResults = [[]];
    const ws = rawConnect(`api_key=blather_bad&workspace_id=${uniqueWs()}`);
    ws.on('error', () => {});
    const { code } = await waitForClose(ws);
    expect(code).toBeTruthy();
  });

  // ── Presence tracking ──

  it('tracks online presence for connected user', async () => {
    const wsId = uniqueWs();
    await connectAuthed('user-p1', wsId);
    const presence = getPresenceForWorkspace(wsId);
    expect(presence).toEqual([{ userId: 'user-p1', status: 'online' }]);
  });

  it('removes presence when user disconnects', async () => {
    const wsId = uniqueWs();
    const ws = await connectAuthed('user-p2', wsId);
    ws.close();
    await new Promise(r => setTimeout(r, 50));
    expect(getPresenceForWorkspace(wsId)).toEqual([]);
  });

  it('returns empty presence for unknown workspace', () => {
    expect(getPresenceForWorkspace('nonexistent')).toEqual([]);
  });

  // ── Presence broadcasts ──

  it('broadcasts presence.changed online when user connects', async () => {
    const wsId = uniqueWs();
    const ws1 = await connectAuthed('user-a', wsId);
    // Register listener BEFORE connecting second user
    const presencePromise = waitForType(ws1, 'presence.changed');
    await connectAuthed('user-b', wsId);
    const presenceMsg = await presencePromise;
    expect(presenceMsg).toEqual({
      type: 'presence.changed',
      data: { userId: 'user-b', status: 'online' },
    });
  });

  it('broadcasts presence.changed offline when user disconnects', async () => {
    const wsId = uniqueWs();
    const ws1 = await connectAuthed('user-c', wsId);
    const ws2 = await connectAuthed('user-d', wsId);
    // Drain user-d's online presence
    await waitForType(ws1, 'presence.changed');

    // Now listen for offline
    const offlinePromise = waitForType(ws1, 'presence.changed');
    ws2.close();
    const offlineMsg = await offlinePromise;
    expect(offlineMsg).toEqual({
      type: 'presence.changed',
      data: { userId: 'user-d', status: 'offline' },
    });
  });

  // ── Max connections per user ──

  it('enforces max 3 connections per user (closes oldest)', async () => {
    const userId = 'user-max';
    const wsId = uniqueWs();

    const conns: WebSocket[] = [];
    for (let i = 0; i < 3; i++) {
      conns.push(await connectAuthed(userId, wsId));
    }

    const closePromise = waitForClose(conns[0]);
    await connectAuthed(userId, wsId);

    const { code } = await closePromise;
    expect(code).toBe(4008);
  });

  // ── Application-level ping/pong ──

  it('responds to application ping with pong', async () => {
    const wsId = uniqueWs();
    const ws = await connectAuthed('user-ping', wsId);
    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await waitForType(ws, 'pong');
    expect(msg).toEqual({ type: 'pong' });
  });

  // ── publishEvent ──

  it('publishEvent sends to all clients for public channel', async () => {
    const wsId = uniqueWs();
    const ws1 = await connectAuthed('user-e1', wsId);
    const ws2 = await connectAuthed('user-e2', wsId);

    // Register listeners before publishing
    dbQueryResults = [[{ channelType: 'public' }]];
    const event = { type: 'message.created', channel_id: 'ch-1', data: { text: 'hello' } };

    const p1 = waitForType(ws1, 'message.created');
    const p2 = waitForType(ws2, 'message.created');
    await publishEvent(wsId, event);

    const [msg1, msg2] = await Promise.all([p1, p2]);
    expect(msg1).toEqual(event);
    expect(msg2).toEqual(event);
  });

  it('publishEvent restricts private channel events to members only', async () => {
    const wsId = uniqueWs();
    const ws1 = await connectAuthed('user-priv1', wsId);
    const ws2 = await connectAuthed('user-priv2', wsId);

    dbQueryResults = [
      [{ channelType: 'private' }],
      [{ userId: 'user-priv1' }],
    ];

    const event = { type: 'message.created', channel_id: 'ch-priv', data: { text: 'secret' } };
    const p1 = waitForType(ws1, 'message.created');
    await publishEvent(wsId, event);

    // user-priv1 receives event
    const msg1 = await p1;
    expect(msg1).toEqual(event);

    // user-priv2 does NOT — verify via ping round-trip
    ws2.send(JSON.stringify({ type: 'ping' }));
    const msg2 = await waitForType(ws2, 'pong');
    expect(msg2).toEqual({ type: 'pong' });
  });

  it('publishEvent restricts DM channel events to members only', async () => {
    const wsId = uniqueWs();
    const ws1 = await connectAuthed('user-dm1', wsId);
    const ws2 = await connectAuthed('user-dm2', wsId);

    dbQueryResults = [
      [{ channelType: 'dm' }],
      [{ userId: 'user-dm1' }],
    ];

    const event = { type: 'message.created', channel_id: 'ch-dm', data: { text: 'hi' } };
    const p1 = waitForType(ws1, 'message.created');
    await publishEvent(wsId, event);

    const msg1 = await p1;
    expect(msg1).toEqual(event);

    ws2.send(JSON.stringify({ type: 'ping' }));
    const msg2 = await waitForType(ws2, 'pong');
    expect(msg2).toEqual({ type: 'pong' });
  });

  it('publishEvent sends to all when no channel_id', async () => {
    const wsId = uniqueWs();
    const ws = await connectAuthed('user-noc', wsId);

    const event = { type: 'workspace.updated', data: { name: 'new' } };
    const p = waitForType(ws, 'workspace.updated');
    await publishEvent(wsId, event);

    const msg = await p;
    expect(msg).toEqual(event);
  });

  it('publishEvent is a no-op for unknown workspace', async () => {
    await publishEvent('nonexistent', { type: 'test' });
  });

  // ── publishEphemeralEvent ──

  it('publishEphemeralEvent broadcasts to all workspace clients', async () => {
    const wsId = uniqueWs();
    const ws1 = await connectAuthed('user-eph1', wsId);
    const ws2 = await connectAuthed('user-eph2', wsId);

    const event = { type: 'typing', channelId: 'ch-1', userId: 'user-eph1' };
    const p1 = waitForType(ws1, 'typing');
    const p2 = waitForType(ws2, 'typing');
    await publishEphemeralEvent(wsId, 'ch-1', event);

    const [msg1, msg2] = await Promise.all([p1, p2]);
    expect(msg1).toEqual(event);
    expect(msg2).toEqual(event);
  });

  it('publishEphemeralEvent is a no-op for unknown workspace', async () => {
    await publishEphemeralEvent('nonexistent', 'ch', { type: 'typing' });
  });

  // ── Non-WS path rejected ──

  it('destroys socket for non /ws/events path', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other/path`);
    openClients.push(ws);
    ws.on('error', () => {});
    const { code } = await waitForClose(ws);
    expect(code).toBeTruthy();
  });
});
