/**
 * Legacy workspace-scoped endpoints for backward compatibility with
 * OpenClaw plugin agents that still pass workspaceId in their config.
 *
 * These 307-redirect to the new flat endpoints so the real handlers
 * (and their rate limits) are the single source of truth.
 *
 * Safe to remove after 2026-04-02 once all agents have been updated to
 * use the new workspace-free API.
 */

import { Hono } from 'hono';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';

export const legacyWorkspaceRoutes = new Hono<Env>();
legacyWorkspaceRoutes.use('*', authMiddleware);

// GET /workspaces/:id/channels → 307 to GET /channels
legacyWorkspaceRoutes.get('/:id/channels', (c) => {
  console.warn(`[legacy] GET /workspaces/${c.req.param('id')}/channels → /channels (deprecated, remove after 2026-04-02)`);
  return c.redirect('/channels', 307);
});

// GET /workspaces/:id/members → 307 to GET /members
legacyWorkspaceRoutes.get('/:id/members', (c) => {
  console.warn(`[legacy] GET /workspaces/${c.req.param('id')}/members → /members (deprecated, remove after 2026-04-02)`);
  return c.redirect('/members', 307);
});
