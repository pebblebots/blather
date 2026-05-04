import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { apiKeys, channelMembers, channels } from '@blather/db';
import { createDb } from "@blather/db";
import { JWT_SECRET } from '../config.js';
import { isGuestModeEnabled, GUEST_USER_ID } from '../config/guest-mode.js';

let db: ReturnType<typeof createDb> = createDb();

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
  // T#161: guest connections are anonymous and share one identity. Don't
  // count them toward per-user caps and don't broadcast presence for them.
  if (client.userId === GUEST_USER_ID) {
    allClients.add(client);
    return;
  }
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
  if (client.userId === GUEST_USER_ID) return;
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

/**
 * Look up member user ids for a channel. Used to filter WS fanout by channel
 * membership (T#151: public channels gated by membership too).
 */
async function getChannelMemberIds(channelId: string): Promise<Set<string>> {
  const members = await db.select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId));
  return new Set(members.map(m => m.userId));
}

/**
 * T#161 helper: is this channel public? Cached lookup used to gate guest
 * WS fanout. Guests have no channel_members rows, so the normal membership
 * filter would skip them on every event — we bypass it only when the
 * channel is public.
 */
const _publicChannelCache = new Map<string, boolean>();
async function isPublicChannel(channelId: string): Promise<boolean> {
  const cached = _publicChannelCache.get(channelId);
  if (cached !== undefined) return cached;
  const [row] = await db.select({ channelType: channels.channelType })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  const isPublic = row?.channelType === 'public';
  _publicChannelCache.set(channelId, isPublic);
  // Invalidate after 30s so channel-type flips (rare) propagate.
  setTimeout(() => _publicChannelCache.delete(channelId), 30_000).unref();
  return isPublic;
}

/** Broadcast an event to all WS clients, gated by channel membership. */
export async function publishEvent(event: Record<string, unknown> & { channel_id?: string | null }) {
  let allowedUserIds: Set<string> | null = null;
  let guestAllowed = false;

  // T#156: If event is scoped to a channel, fanout is gated by membership —
  // public, private, and DM all require a channel_members row.
  // T#161: guests (no membership rows) are allowed on public channels only.
  if (event.channel_id) {
    allowedUserIds = await getChannelMemberIds(event.channel_id);
    guestAllowed = await isPublicChannel(event.channel_id);
  }

  const data = JSON.stringify(event);
  for (const client of allClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (allowedUserIds) {
      const isGuestClient = client.userId === GUEST_USER_ID;
      if (isGuestClient) {
        if (!guestAllowed) continue;
      } else if (!allowedUserIds.has(client.userId)) {
        continue;
      }
    }
    client.ws.send(data);
  }
}

/**
 * Broadcast an ephemeral event (no DB write).
 * T#157: if the event is scoped to a channel (`channel_id`), fanout is gated
 * by membership like `publishEvent`. Events without `channel_id` (global
 * ephemerals) still broadcast to everyone.
 */
export async function publishEphemeralEvent(event: Record<string, unknown> & { channel_id?: string | null }) {
  let allowedUserIds: Set<string> | null = null;
  let guestAllowed = false;

  if (event.channel_id) {
    allowedUserIds = await getChannelMemberIds(event.channel_id);
    guestAllowed = await isPublicChannel(event.channel_id);
  }

  const data = JSON.stringify(event);
  for (const client of allClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (allowedUserIds) {
      const isGuestClient = client.userId === GUEST_USER_ID;
      if (isGuestClient) {
        if (!guestAllowed) continue;
      } else if (!allowedUserIds.has(client.userId)) {
        continue;
      }
    }
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
    } else if (isGuestModeEnabled()) {
      // T#161: guest-mode deployment — accept anonymous upgrade and attach as
      // the shared guest identity. Only public-channel events will fan out
      // to this client (see publishEvent).
      wss.handleUpgrade(req, socket, head, (ws) => {
        setupAuthedClient(ws, GUEST_USER_ID);
      });
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
    _publicChannelCache.clear();
  },
  /**
   * Swap the module-scope db for tests. Call with `null` to revert.
   * Only exposed under __testing so production code can't reach it.
   */
  setDbForTesting(next: ReturnType<typeof createDb> | null) {
    db = next ?? createDb();
  },
  setupAuthedClient,
  setupPendingClient,
  verifyToken,
  resolveApiKeyUserId,
};
