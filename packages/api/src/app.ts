import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { createDb, type Db } from '@blather/db';
import { createAuthRoutes } from './routes/auth.js';
import { channelRoutes } from './routes/channels.js';
import { memberRoutes } from './routes/members.js';
import { taskRoutes } from './routes/tasks.js';
import { dealRoutes } from './routes/deals.js';
import { incidentRoutes } from './routes/incidents.js';
import { messageRoutes } from './routes/messages.js';
import { uploadRoutes } from './routes/uploads.js';
import { ttsRoutes } from './routes/tts.js';
import { huddleRoutes } from './routes/huddles.js';
import { activityRoutes } from './routes/activity.js';
import { metricRoutes } from './routes/metrics.js';
import { statusRoutes } from './routes/status.js';
import { generalApiLimiter, messageSendLimiter, uploadLimiter, type RateLimitStore } from './middleware/rate-limit.js';

export type Env = {
  Variables: {
    userId: string;
    db: Db;
    // Role marker set by the auth middleware. Currently only used for
    // guest-mode (T#161) — guests are synthesized on unauthenticated
    // requests when GUEST_MODE_VIEW_ONLY=true and can only read public
    // channels. Authenticated users leave this unset.
    role?: 'guest';
  };
};

export function createApp(db: Db = createDb(), rateLimitStore?: RateLimitStore): Hono<Env> {
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

  // Public, unauthenticated health probe. Always returns 200 with a tiny
  // body when the API process is alive and responsive. Mounted at both
  // `/health` and `/api/health` to survive Caddy prefix stripping
  // inconsistencies (see T#164 context: Aura misdiagnosed the API as dead
  // because GET /api/me returns 404 — /me is the real route). Do NOT
  // add auth/rate-limit middleware here; downstream probes need cheap 200s.
  const healthHandler = (c: any) => c.json({ ok: true, service: 'blather-api' });
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  // Per-user general rate limit on authenticated routes (applied before route handlers)
  const generalLimiter = generalApiLimiter(rateLimitStore);
  for (const prefix of ['/channels', '/members', '/tasks', '/deals', '/incidents', '/messages', '/uploads', '/tts', '/huddles', '/metrics', '/activity', '/status', '/presence']) {
    app.use(`${prefix}/*`, generalLimiter);
  }

  // Stricter per-user limits for message sending and file uploads
  app.post('/messages/*', messageSendLimiter(rateLimitStore));
  app.post('/uploads/*', uploadLimiter(rateLimitStore));

  app.route('/auth', createAuthRoutes(rateLimitStore));
  app.route('/channels', channelRoutes);
  app.route('/members', memberRoutes);
  app.route('/tasks', taskRoutes);
  app.route('/deals', dealRoutes);
  app.route('/incidents', incidentRoutes);
  app.route('/messages', messageRoutes);
  app.route('/uploads', uploadRoutes);
  app.route('/tts', ttsRoutes);
  app.route('/huddles', huddleRoutes);
  app.route('/metrics', metricRoutes);
  app.route('/activity', activityRoutes);
  app.route('/status', statusRoutes);

  return app;
}

export const app = createApp();
