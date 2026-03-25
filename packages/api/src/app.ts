import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { createDb, type Db } from '@blather/db';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { channelRoutes } from './routes/channels.js';
import { taskRoutes } from './routes/tasks.js';
import { incidentRoutes } from './routes/incidents.js';
import { messageRoutes } from './routes/messages.js';
import { uploadRoutes } from './routes/uploads.js';
import { ttsRoutes } from './routes/tts.js';
import { huddleRoutes } from './routes/huddles.js';
import { memoryRoutes } from './routes/memory.js';
import { activityRoutes } from './routes/activity.js';
import { metricRoutes } from './routes/metrics.js';

export type Env = {
  Variables: {
    userId: string;
    db: Db;
  };
};

export function createApp(db: Db = createDb()): Hono<Env> {
  const app = new Hono<Env>();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    }),
  );

  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });

  app.use('*', logger());

  app.get('/', (c) => c.json({ name: 'blather', version: '0.1.0' }));

  app.route('/auth', authRoutes);
  app.route('/workspaces', workspaceRoutes);
  app.route('/channels', channelRoutes);
  app.route('/tasks', taskRoutes);
  app.route('/incidents', incidentRoutes);
  app.route('/messages', messageRoutes);
  app.route('/uploads', uploadRoutes);
  app.route('/memory', memoryRoutes);
  app.route('/tts', ttsRoutes);
  app.route('/huddles', huddleRoutes);
  app.route('/metrics', metricRoutes);
  app.route('/activity', activityRoutes);

  return app;
}

export const app = createApp();
