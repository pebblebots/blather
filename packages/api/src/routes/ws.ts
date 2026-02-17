import { Hono } from 'hono';
import type { Env } from '../app.js';

export const wsRoutes = new Hono<Env>();

// WebSocket upgrade is handled directly on the raw HTTP server in index.ts
// No Hono routes needed here — having a GET /events route was intercepting
// the upgrade request and returning a JSON response instead of allowing
// the WebSocket handshake to proceed.
