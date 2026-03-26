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
  workspaceId: string;
  alive: boolean;
  lastActivity: number;
}

// workspaceId -> set of clients
const workspaceClients = new Map<string, Set<AuthedClient>>();

function addClient(client: AuthedClient) {
  let set = workspaceClients.get(client.workspaceId);
  if (!set) {
    set = new Set();
    workspaceClients.set(client.workspaceId, set);
  }
  // Limit connections per user — close oldest if over limit
  const userConns = [...set].filter(c => c.userId === client.userId);
  while (userConns.length >= MAX_CONNECTIONS_PER_USER) {
    const oldest = userConns.shift()!;
    oldest.ws.close(4008, 'Too many connections');
    set.delete(oldest);
  }
  set.add(client);
  broadcastPresence(client.workspaceId, client.userId, 'online');
}

function removeClient(client: AuthedClient) {
  const set = workspaceClients.get(client.workspaceId);
  if (set) {
    set.delete(client);
    if (set.size === 0) workspaceClients.delete(client.workspaceId);
    // Check if user still has other connections in this workspace
    const stillConnected = set ? [...set].some(c => c.userId === client.userId) : false;
    if (!stillConnected) {
      broadcastPresence(client.workspaceId, client.userId, 'offline');
    }
  }
}

/** Broadcast presence change to all clients in a workspace (no DB write) */
function broadcastPresence(workspaceId: string, userId: string, status: string) {
  const set = workspaceClients.get(workspaceId);
  if (!set) return;
  const data = JSON.stringify({ type: 'presence.changed', data: { userId, status } });
  for (const client of set) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(data);
  }
}

/** Get presence status for all members of a workspace */
export function getPresenceForWorkspace(workspaceId: string): { userId: string; status: 'online' | 'idle' | 'offline' }[] {
  const set = workspaceClients.get(workspaceId);
  if (!set) return [];
  const now = Date.now();
  const userStatus = new Map<string, 'online' | 'idle'>();
  for (const client of set) {
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

/** Broadcast an event to all WS clients in a workspace, respecting channel privacy */
export async function publishEvent(workspaceId: string, event: Record<string, unknown> & { channel_id?: string | null }) {
  const set = workspaceClients.get(workspaceId);
  if (!set) return;

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
  for (const client of set) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    // If channel is private/dm, only send to members
    if (allowedUserIds && !allowedUserIds.has(client.userId)) continue;
    client.ws.send(data);
  }
}

/** Broadcast an ephemeral event (no DB write). */
export async function publishEphemeralEvent(workspaceId: string, event: Record<string, unknown>) {
  const set = workspaceClients.get(workspaceId);
  if (!set) return;

  const data = JSON.stringify(event);
  for (const client of set) {
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
  const prevIdleUsers = new Map<string, Set<string>>();

  // Heartbeat interval
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [wsId, clients] of workspaceClients) {
      for (const client of clients) {
        if (!client.alive) {
          client.ws.terminate();
          removeClient(client);
          continue;
        }
        client.alive = false;
        client.ws.ping();
      }

      // Check for idle transitions
      const prevIdle = prevIdleUsers.get(wsId) || new Set<string>();
      const currentIdle = new Set<string>();
      const currentClients = workspaceClients.get(wsId);
      if (currentClients) {
        for (const client of currentClients) {
          if (now - client.lastActivity >= IDLE_THRESHOLD) {
            currentIdle.add(client.userId);
            if (!prevIdle.has(client.userId)) {
              broadcastPresence(wsId, client.userId, 'idle');
            }
          }
        }
        // Check for users who became active again
        for (const userId of prevIdle) {
          if (!currentIdle.has(userId)) {
            const still = [...currentClients].some(c => c.userId === userId);
            if (still) broadcastPresence(wsId, userId, 'online');
          }
        }
      }
      prevIdleUsers.set(wsId, currentIdle);
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
        resolveApiKeyUserId(apiKeyParam).then((foundUserId) => {
          if (!foundUserId) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            setupAuthedClient(ws, foundUserId, workspaceId);
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
  const client: AuthedClient = { ws, userId, workspaceId, alive: true, lastActivity: Date.now() };
  addClient(client);

  ws.send(JSON.stringify({ type: 'connected', userId, workspaceId }));

  ws.on('pong', () => { client.alive = true; });
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

export const __testing = {
  resetState() {
    workspaceClients.clear();
  },
  setupAuthedClient,
  setupPendingClient,
  verifyToken,
  resolveApiKeyUserId,
};
