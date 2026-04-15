import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { app } from './app.js';
import { attachWebSocket } from './ws/manager.js';

const port = parseInt(process.env.PORT || '3000', 10);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`yappers API running on http://localhost:${info.port}`);
});

attachWebSocket(server as unknown as Server);
