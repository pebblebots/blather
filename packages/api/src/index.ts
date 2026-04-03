import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { app } from './app.js';
import { attachWebSocket } from './ws/manager.js';
import { initializeConfig } from './config.js';

async function startServer() {
  // Initialize configuration (including secrets) before starting the server
  try {
    await initializeConfig();
    console.log('[INFO] Configuration loaded successfully');
  } catch (error) {
    console.error('[FATAL] Failed to initialize configuration:', error);
    process.exit(1);
  }

  const port = parseInt(process.env.PORT || '3000', 10);

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Blather API running on http://localhost:${info.port}`);
  });

  attachWebSocket(server as unknown as Server);
}

startServer().catch((error) => {
  console.error('[FATAL] Failed to start server:', error);
  process.exit(1);
});
