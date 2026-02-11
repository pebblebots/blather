import { Hono } from 'hono';
import type { Env } from '../app.js';

export const wsRoutes = new Hono<Env>();

// Info endpoint — actual WebSocket upgrade is handled in index.ts on the raw HTTP server
wsRoutes.get('/events', (c) => {
  return c.json({
    message: 'WebSocket endpoint. Connect with ws:// and a WebSocket client.',
    protocol: 'Auth via ?token=<jwt> query param, or send {"type":"auth","token":"...","workspaceId":"..."} as first message.',
  });
});
