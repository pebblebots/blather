import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { apiKeys, channels, channelMembers } from '@blather/db';
import { createDb } from '@blather/db';

const JWT_SECRET = process.env.JWT_SECRET || 'blather-dev-secret-change-in-production';

const HEARTBEAT_INTERVAL = 30_000;

interface AuthedClient {
  ws: WebSocket;
  userId: string;
  workspaceId: string;
  alive: boolean;
}

// workspaceId -> set of clients
const workspaceClients = new Map<string, Set<AuthedClient>>();

function addClient(client: AuthedClient) {
  let set = workspaceClients.get(client.workspaceId);
  if (!set) {
    set = new Set();
    workspaceClients.set(client.workspaceId, set);
  }
  set.add(client);
}

function removeClient(client: AuthedClient) {
  const set = workspaceClients.get(client.workspaceId);
  if (set) {
    set.delete(client);
    if (set.size === 0) workspaceClients.delete(client.workspaceId);
  }
}

/** Broadcast an event to all WS clients in a workspace, respecting channel privacy */
export async function publishEvent(workspaceId: string, event: Record<string, unknown> & { channel_id?: string | null }) {
  const set = workspaceClients.get(workspaceId);
  if (!set) return;

  let allowedUserIds: Set<string> | null = null;

  // If event is for a specific channel, check if it's private/dm
  if (event.channel_id) {
    const db = createDb();
    const [ch] = await db.select({ channelType: channels.channelType })
      .from(channels)
      .where(eq(channels.id, event.channel_id))
      .limit(1);

    if (ch && (ch.channelType === 'dm' || ch.channelType === 'private')) {
      const members = await db.select({ userId: channelMembers.userId })
        .from(channelMembers)
        .where(eq(channelMembers.channelId, event.channel_id));
      allowedUserIds = new Set(members.map(m => m.userId));
    }
  }

  const data = JSON.stringify(event);
  for (const client of set) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    // If channel is private/dm, only send to members
    if (allowedUserIds && !allowedUserIds.has(client.userId)) continue;
    client.ws.send(data);
  }
}

/** Broadcast an ephemeral event (no DB write) — respects channel privacy */
export async function publishEphemeralEvent(workspaceId: string, channelId: string, event: Record<string, unknown>) {
  const set = workspaceClients.get(workspaceId);
  if (!set) return;

  let allowedUserIds: Set<string> | null = null;

  const db = createDb();
  const [ch] = await db.select({ channelType: channels.channelType })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  if (ch && (ch.channelType === "dm" || ch.channelType === "private")) {
    const members = await db.select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(eq(channelMembers.channelId, channelId));
    allowedUserIds = new Set(members.map(m => m.userId));
  }

  const data = JSON.stringify(event);
  for (const client of set) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (allowedUserIds && !allowedUserIds.has(client.userId)) continue;
    client.ws.send(data);
  }
}

function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  // Heartbeat interval
  const interval = setInterval(() => {
    for (const [, clients] of workspaceClients) {
      for (const client of clients) {
        if (!client.alive) {
          client.ws.terminate();
          removeClient(client);
          continue;
        }
        client.alive = false;
        client.ws.ping();
      }
    }
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => clearInterval(interval));

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/events') {
      socket.destroy();
      return;
    }

    // Try auth from query param
    const token = url.searchParams.get('token');
    const apiKeyParam = url.searchParams.get('api_key');
    const workspaceId = url.searchParams.get('workspace_id');

    if (workspaceId && (token || apiKeyParam)) {
      // JWT auth
      if (token) {
        const userId = verifyToken(token);
        if (!userId) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          setupAuthedClient(ws, userId, workspaceId);
        });
        return;
      }
      // API key auth
      if (apiKeyParam) {
        const db = createDb();
        const hash = createHash('sha256').update(apiKeyParam).digest('hex');
        db.select().from(apiKeys).where(
          and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt))
        ).limit(1).then(([found]) => {
          if (!found) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            setupAuthedClient(ws, found.userId, workspaceId);
          });
        }).catch(() => {
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
          socket.destroy();
        });
        return;
      }
    } else {
      // Auth via first message
      wss.handleUpgrade(req, socket, head, (ws) => {
        setupPendingClient(ws);
      });
    }
  });
}

function setupAuthedClient(ws: WebSocket, userId: string, workspaceId: string) {
  const client: AuthedClient = { ws, userId, workspaceId, alive: true };
  addClient(client);

  ws.send(JSON.stringify({ type: 'connected', userId, workspaceId }));

  ws.on('pong', () => { client.alive = true; });
  ws.on('close', () => removeClient(client));
  ws.on('error', () => removeClient(client));

  ws.on('message', (raw) => {
    // Once authed, clients can send pings or subscribe to more workspaces in future
    // For now, just keep-alive
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch { /* ignore */ }
  });
}

function setupPendingClient(ws: WebSocket) {
  const timeout = setTimeout(() => {
    ws.close(4001, 'Auth timeout');
  }, 10_000);

  ws.once('message', (raw) => {
    clearTimeout(timeout);
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'auth' || !msg.token || !msg.workspaceId) {
        ws.close(4002, 'Invalid auth message');
        return;
      }
      const userId = verifyToken(msg.token);
      if (!userId) {
        ws.close(4003, 'Invalid token');
        return;
      }
      setupAuthedClient(ws, userId, msg.workspaceId);
    } catch {
      ws.close(4002, 'Invalid message');
    }
  });
}
