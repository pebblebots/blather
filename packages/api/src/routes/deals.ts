import { Hono } from 'hono';
import type { Env } from '../app.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  listDeals,
  createDeal,
  getDeal,
  updateDeal,
  deleteDeal,
  resolveDeal,
  getDealChanges,
} from '../deals/queries.js';
import type { DealStage, DealStatus } from '../deals/queries.js';

export const dealRoutes = new Hono<Env>();
dealRoutes.use('*', authMiddleware);

const VALID_STAGES: DealStage[] = ['sourcing', 'dd', 'pass', 'move', 'portfolio'];
const VALID_STATUSES: DealStatus[] = ['active', 'watchlist', 'zombie', 'exited', 'inactive'];

// List deals
dealRoutes.get('/', async (c) => {
  const stage = c.req.query('stage');
  const status = c.req.query('status');
  const name = c.req.query('name');
  const includeArchived = c.req.query('includeArchived') === 'true';

  if (stage && !VALID_STAGES.includes(stage as DealStage)) {
    return c.json({ error: 'Invalid stage: ' + stage }, 400);
  }

  if (status && !VALID_STATUSES.includes(status as DealStatus)) {
    return c.json({ error: 'Invalid status: ' + status }, 400);
  }

  const result = listDeals({
    stage: stage as DealStage | undefined,
    status: status as DealStatus | undefined,
    name: name || undefined,
    includeArchived,
  });

  return c.json(result);
});

// Get deal change history
dealRoutes.get('/:id/changes', async (c) => {
  const id = c.req.param('id');
  const deal = resolveDeal(id);
  if (!deal) return c.json({ error: 'Deal not found' }, 404);

  const agent_id = c.req.query('agent_id');
  const field = c.req.query('field');

  const changes = getDealChanges(deal.id, {
    agent_id: agent_id || undefined,
    field: field || undefined,
  });
  return c.json(changes);
});

// Get single deal (by UUID or D#N short ID)
dealRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const deal = resolveDeal(id);
  if (!deal) return c.json({ error: 'Deal not found' }, 404);
  return c.json(deal);
});

// Create deal
dealRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    name: string;
    company?: string;
    stage?: DealStage;
    thesis?: string;
    contacts?: string;
    source_agent_id?: string;
    source_channel_id?: string;
    round?: string;
    amount?: string;
    lead_investor?: string;
    notes?: string;
    external_id?: string;
    external_source?: string;
    updated_by_agent_id?: string;
    status?: DealStatus;
    next_meeting_at?: string;
    archived?: boolean;
  }>();

  if (!body.name) {
    return c.json({ error: 'name required' }, 400);
  }

  if (body.stage && !VALID_STAGES.includes(body.stage)) {
    return c.json({ error: 'Invalid stage: ' + body.stage }, 400);
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return c.json({ error: 'Invalid status: ' + body.status }, 400);
  }

  const deal = createDeal({
    name: body.name,
    company: body.company ?? null,
    stage: body.stage ?? 'sourcing',
    thesis: body.thesis ?? null,
    contacts: body.contacts ?? null,
    source_agent_id: body.source_agent_id ?? null,
    source_channel_id: body.source_channel_id ?? null,
    round: body.round ?? null,
    amount: body.amount ?? null,
    lead_investor: body.lead_investor ?? null,
    notes: body.notes ?? null,
    external_id: body.external_id ?? null,
    external_source: body.external_source ?? null,
    updated_by_agent_id: body.updated_by_agent_id ?? null,
    status: body.status ?? 'active',
    next_meeting_at: body.next_meeting_at ?? null,
    archived: body.archived ?? false,
  });

  return c.json(deal, 201);
});

// Update deal (partial)
dealRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = resolveDeal(id);
  if (!existing) return c.json({ error: 'Deal not found' }, 404);

  const body = await c.req.json<{
    name?: string;
    company?: string | null;
    stage?: DealStage;
    thesis?: string | null;
    contacts?: string | null;
    source_agent_id?: string | null;
    source_channel_id?: string | null;
    round?: string | null;
    amount?: string | null;
    lead_investor?: string | null;
    notes?: string | null;
    external_id?: string | null;
    external_source?: string | null;
    updated_by_agent_id?: string | null;
    status?: DealStatus;
    next_meeting_at?: string | null;
    archived?: boolean;
  }>();

  if (body.stage && !VALID_STAGES.includes(body.stage)) {
    return c.json({ error: 'Invalid stage: ' + body.stage }, 400);
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return c.json({ error: 'Invalid status: ' + body.status }, 400);
  }

  const deal = updateDeal(existing.id, body);
  if (!deal) return c.json({ error: 'Deal not found' }, 404);

  return c.json(deal);
});

// Delete deal
dealRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const resolved = resolveDeal(id);
  const deleted = resolved ? deleteDeal(resolved.id) : false;
  if (!deleted) return c.json({ error: 'Deal not found' }, 404);
  return c.json({ ok: true });
});
