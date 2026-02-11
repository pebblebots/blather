import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { createDb } from '@blather/db';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { channelRoutes } from './routes/channels.js';
import { wsRoutes } from './routes/ws.js';

export type Env = {
  Variables: {
    userId: string;
    db: ReturnType<typeof createDb>;
  };
};

const db = createDb();

export const app = new Hono<Env>();

// Inject db into context
app.use('*', async (c, next) => {
  c.set('db', db);
  await next();
});

app.use('*', logger());

app.get('/', (c) => c.json({ name: 'blather', version: '0.1.0' }));

app.route('/auth', authRoutes);
app.route('/workspaces', workspaceRoutes);
app.route('/channels', channelRoutes);
app.route('/ws', wsRoutes);
