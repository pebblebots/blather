import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { apiKeys, channels, channelMembers } from '@blather/db';
import { createDb } from "@blather/db";
import { JWT_SECRET } from '../config.js';

const db = createDb();

const HEARTBEAT_INTERVAL = 30_000;
const IDLE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const MAX_CONNECTIONS_PER_USER = 3;

interface AuthedClient {
  ws: WebSocket;
  userId: string;
  alive: boolean;
  lastActivity: number;
}

const allClients = new Set<AuthedClient>();

function addClient(client: AuthedClient) {
  // Limit connections per user — close oldest if over limit
  const userConns = [...allClients].filter(c => c.userId === client.userId);
  while (userConns.length >= MAX_CONNECTIONS_PER_USER) {
    const oldest = userConns.shift()!;
    oldest.ws.close(4008, 'Too many connections');
    allClients.delete(oldest);
  }
  allClients.add(client);
  broadcastPresence(client.userId, 'online');
}

function removeClient(client: AuthedClient) {
  allClients.delete(client);
  // Check if user still has other connections
  const stillConnected = [...allClients].some(c => c.userId === client.userId);
  if (!stillConnected) {
    broadcastPresence(client.userId, 'offline');
  }
}

/** Broadcast presence change to all clients (no DB write) */
function broadcastPresence(userId: string, status: string) {
  const data = JSON.stringify({ type: 'presence.changed', data: { userId, status } });
  for (const client of allClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(data);
  }
}

/** Get presence status for all connected users */
export function getPresence(): { userId: string; status: 'online' | 'idle' | 'offline' }[] {
  const now = Date.now();
  const userStatus = new Map<string, 'online' | 'idle'>();
  for (const client of allClients) {
    const elapsed = now - client.lastActivity;
    const status = elapsed < IDLE_THRESHOLD ? 'online' : 'idle';
    const existing = userStatus.get(client.userId);
    // If any connection is online, user is online
    if (!existing || status === 'online') {
      userStatus.set(client.userId, status);
    }
  }
  return [...userStatus.entries()].map(([userId, status]) => ({ userId, status }));
}

/** Broadcast a status change for a user to all connected clients. */
export function broadcastStatusForUser(userId: string, status: { text: string; progress?: number; eta?: string } | null) {
  const data = JSON.stringify({ type: 'status.changed', data: { userId, status } });
  for (const client of allClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(data);
  }
}

/** Broadcast an event to all WS clients, respecting channel privacy */
export async function publishEvent(event: Record<string, unknown> & { channel_id?: string | null }) {
  let allowedUserIds: Set<string> | null = null;

  // If event is for a specific channel, check if it's private/dm
  if (event.channel_id) {

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
  for (const client of allClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    // If channel is private/dm, only send to members
    if (allowedUserIds && !allowedUserIds.has(client.userId)) continue;
    client.ws.send(data);
  }
}

/** Broadcast an ephemeral event (no DB write). */
export async function publishEphemeralEvent(event: Record<string, unknown>) {
  const data = JSON.stringify(event);
  for (const client of allClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
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

async function resolveApiKeyUserId(apiKeyParam: string): Promise<string | null> {
  const hash = createHash('sha256').update(apiKeyParam).digest('hex');
  const [found] = await db.select().from(apiKeys).where(
    and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt))
  ).limit(1);
  return found?.userId ?? null;
}

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  // Track previous idle states to detect transitions
  const prevIdleUsers = new Set<string>();

  // Heartbeat interval
  const interval = setInterval(() => {
    const now = Date.now();
    for (const client of allClients) {
      if (!client.alive) {
        client.ws.terminate();
        removeClient(client);
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }

    // Check for idle transitions
    const currentIdle = new Set<string>();
    for (const client of allClients) {
      if (now - client.lastActivity >= IDLE_THRESHOLD) {
        currentIdle.add(client.userId);
        if (!prevIdleUsers.has(client.userId)) {
          broadcastPresence(client.userId, 'idle');
        }
      }
    }
    // Check for users who became active again
    for (const userId of prevIdleUsers) {
      if (!currentIdle.has(userId)) {
        const still = [...allClients].some(c => c.userId === userId);
        if (still) broadcastPresence(userId, 'online');
      }
    }
    prevIdleUsers.clear();
    for (const u of currentIdle) prevIdleUsers.add(u);
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

    if (token || apiKeyParam) {
      // JWT auth
      if (token) {
        const userId = verifyToken(token);
        if (!userId) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          setupAuthedClient(ws, userId);
        });
        return;
      }
      // API key auth
      if (apiKeyParam) {
        resolveApiKeyUserId(apiKeyParam).then((foundUserId) => {
          if (!foundUserId) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            setupAuthedClient(ws, foundUserId);
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

function setupAuthedClient(ws: WebSocket, userId: string) {
  const client: AuthedClient = { ws, userId, alive: true, lastActivity: Date.now() };
  addClient(client);

  ws.send(JSON.stringify({ type: 'connected', userId }));

  ws.on('pong', () => { client.alive = true; client.lastActivity = Date.now(); });
  ws.on('close', () => removeClient(client));
  ws.on('error', () => removeClient(client));

  ws.on('message', (raw) => {
    client.lastActivity = Date.now();
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
      if (msg.type !== 'auth' || !msg.token) {
        ws.close(4002, 'Invalid auth message');
        return;
      }
      const userId = verifyToken(msg.token);
      if (!userId) {
        ws.close(4003, 'Invalid token');
        return;
      }
      setupAuthedClient(ws, userId);
    } catch {
      ws.close(4002, 'Invalid message');
    }
  });
}

export const __testing = {
  resetState() {
    allClients.clear();
  },
  setupAuthedClient,
  setupPendingClient,
  verifyToken,
  resolveApiKeyUserId,
};
