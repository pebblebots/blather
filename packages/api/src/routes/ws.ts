import { Hono } from 'hono';
import type { Env } from '../app.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'blather-dev-secret-change-in-production';

// Simple in-memory pub/sub for v0
const subscribers = new Map<string, Set<(data: string) => void>>();

export function publishEvent(workspaceId: string, event: object) {
  const subs = subscribers.get(workspaceId);
  if (subs) {
    const data = JSON.stringify(event);
    for (const send of subs) send(data);
  }
}

export const wsRoutes = new Hono<Env>();

// WebSocket upgrade handled at the server level
// This is a placeholder route - actual WS upgrade needs @hono/node-server websocket support
wsRoutes.get('/events', (c) => {
  // In production, this would be upgraded to a WebSocket connection
  // For v0, we document the protocol and implement with the node-server adapter
  return c.json({
    message: 'WebSocket endpoint. Connect with a WebSocket client.',
    protocol: 'Send { type: "auth", token: "jwt...", workspaceId: "uuid" } after connecting.',
  });
});
