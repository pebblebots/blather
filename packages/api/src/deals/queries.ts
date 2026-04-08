import { getDealDb } from './db.js';

export type DealStage = 'sourcing' | 'dd' | 'pass' | 'move' | 'portfolio';
/**
 * Deal status enum:
 * - active:    actively tracked / in pipeline
 * - watchlist: monitoring but not actively pursuing
 * - zombie:    company went dark (their side — no responses, activity stale)
 * - inactive:  GP-paused (our side — deliberate deprioritization, company is fine)
 * - exited:    deal closed or company exited portfolio
 */
export type DealStatus = 'active' | 'watchlist' | 'zombie' | 'inactive' | 'exited';

export interface Deal {
  id: string;
  name: string;
  company: string | null;
  stage: DealStage;
  thesis: string | null;
  contacts: string | null;
  source_agent_id: string | null;
  source_channel_id: string | null;
  round: string | null;
  amount: string | null;
  lead_investor: string | null;
  notes: string | null;
  shortId: number | null;
  createdAt: string;
  updatedAt: string;
  external_id: string | null;
  external_source: string | null;
  updated_by_agent_id: string | null;
  status: DealStatus;
  next_meeting_at: string | null;
  archived: boolean;
}

export interface DealChange {
  id: string;
  deal_id: string;
  agent_id: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
  change_type: string;
  created_at: string;
}

const VALID_STAGES: DealStage[] = ['sourcing', 'dd', 'pass', 'move', 'portfolio'];
const VALID_STATUSES: DealStatus[] = ['active', 'watchlist', 'zombie', 'exited', 'inactive'];

function logChange(
  dealId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  changeType: string,
  agentId?: string | null,
): void {
  const db = getDealDb();
  db.prepare(`
    INSERT INTO deal_changes (id, deal_id, agent_id, field, old_value, new_value, change_type, created_at)
    VALUES (@id, @deal_id, @agent_id, @field, @old_value, @new_value, @change_type, @created_at)
  `).run({
    id: crypto.randomUUID(),
    deal_id: dealId,
    agent_id: agentId ?? null,
    field,
    old_value: oldValue,
    new_value: newValue,
    change_type: changeType,
    created_at: new Date().toISOString(),
  });
}

export function listDeals(filters?: {
  stage?: DealStage;
  status?: DealStatus;
  name?: string;
  includeArchived?: boolean;
}): Deal[] {
  const db = getDealDb();
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  // Filter out archived deals by default
  if (!filters?.includeArchived) {
    conditions.push('archived = 0');
  }

  if (filters?.stage) {
    conditions.push('stage = @stage');
    params.stage = filters.stage;
  }
  if (filters?.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters?.name) {
    conditions.push('lower(name) LIKE @name');
    params.name = `%${filters.name.toLowerCase()}%`;
  }

  const rawDeals = conditions.length === 0
    ? db.prepare('SELECT * FROM deals ORDER BY createdAt DESC').all() as any[]
    : db
      .prepare(`SELECT * FROM deals WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC`)
      .all(params) as any[];

  return rawDeals.map(deal => ({ ...deal, archived: Boolean(deal.archived) })) as Deal[];
}

export function getDeal(id: string): Deal | null {
  const rawDeal = getDealDb().prepare('SELECT * FROM deals WHERE id = ?').get(id) as any | null;
  return rawDeal ? { ...rawDeal, archived: Boolean(rawDeal.archived) } as Deal : null;
}

export function createDeal(data: {
  name: string;
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
}): Deal {
  const db = getDealDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const seq = db.prepare('INSERT INTO deal_short_id_seq DEFAULT VALUES').run();
  const shortId = Number(seq.lastInsertRowid);

  db.prepare(`
    INSERT INTO deals (
      id, name, company, stage, thesis, contacts, source_agent_id, source_channel_id, 
      round, amount, lead_investor, notes, shortId, createdAt, updatedAt, 
      external_id, external_source, updated_by_agent_id, status, next_meeting_at, archived
    )
    VALUES (
      @id, @name, @company, @stage, @thesis, @contacts, @source_agent_id, @source_channel_id, 
      @round, @amount, @lead_investor, @notes, @shortId, @createdAt, @updatedAt, 
      @external_id, @external_source, @updated_by_agent_id, @status, @next_meeting_at, @archived
    )
  `).run({
    id,
    name: data.name,
    company: data.company ?? null,
    stage: data.stage ?? 'sourcing',
    thesis: data.thesis ?? null,
    contacts: data.contacts ?? null,
    source_agent_id: data.source_agent_id ?? null,
    source_channel_id: data.source_channel_id ?? null,
    round: data.round ?? null,
    amount: data.amount ?? null,
    lead_investor: data.lead_investor ?? null,
    notes: data.notes ?? null,
    shortId,
    createdAt: now,
    updatedAt: now,
    external_id: data.external_id ?? null,
    external_source: data.external_source ?? null,
    updated_by_agent_id: data.updated_by_agent_id ?? null,
    status: data.status ?? 'active',
    next_meeting_at: data.next_meeting_at ?? null,
    archived: data.archived ? 1 : 0,
  });

  const rawDeal = db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as any;
  const deal = { ...rawDeal, archived: Boolean(rawDeal.archived) } as Deal;

  // Log creation for each field with a value
  const createdFields: Record<string, string | null> = {
    name: data.name,
    company: data.company ?? null,
    stage: data.stage ?? 'sourcing',
    thesis: data.thesis ?? null,
    contacts: data.contacts ?? null,
    source_agent_id: data.source_agent_id ?? null,
    source_channel_id: data.source_channel_id ?? null,
    round: data.round ?? null,
    amount: data.amount ?? null,
    lead_investor: data.lead_investor ?? null,
    notes: data.notes ?? null,
    external_id: data.external_id ?? null,
    external_source: data.external_source ?? null,
    status: data.status ?? 'active',
    next_meeting_at: data.next_meeting_at ?? null,
    archived: String(data.archived ? 1 : 0),
  };
  for (const [field, value] of Object.entries(createdFields)) {
    if (value !== null) {
      logChange(id, field, null, value, 'create', data.source_agent_id);
    }
  }

  return deal;
}

export function updateDeal(
  id: string,
  data: {
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
  },
): Deal | null {
  const db = getDealDb();
  const now = new Date().toISOString();

  // Read current deal before updating for change detection
  const current = db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as any | null;
  if (!current) return null;

  const setClauses: string[] = ['updatedAt = @updatedAt'];
  const params: Record<string, unknown> = { id, updatedAt: now };

  if (data.name !== undefined) { setClauses.push('name = @name'); params.name = data.name; }
  if (data.company !== undefined) { setClauses.push('company = @company'); params.company = data.company; }
  if (data.stage !== undefined) { setClauses.push('stage = @stage'); params.stage = data.stage; }
  if (data.thesis !== undefined) { setClauses.push('thesis = @thesis'); params.thesis = data.thesis; }
  if (data.contacts !== undefined) { setClauses.push('contacts = @contacts'); params.contacts = data.contacts; }
  if (data.source_agent_id !== undefined) { setClauses.push('source_agent_id = @source_agent_id'); params.source_agent_id = data.source_agent_id; }
  if (data.source_channel_id !== undefined) { setClauses.push('source_channel_id = @source_channel_id'); params.source_channel_id = data.source_channel_id; }
  if (data.round !== undefined) { setClauses.push('round = @round'); params.round = data.round; }
  if (data.amount !== undefined) { setClauses.push('amount = @amount'); params.amount = data.amount; }
  if (data.lead_investor !== undefined) { setClauses.push('lead_investor = @lead_investor'); params.lead_investor = data.lead_investor; }
  if (data.notes !== undefined) { setClauses.push('notes = @notes'); params.notes = data.notes; }
  if (data.external_id !== undefined) { setClauses.push('external_id = @external_id'); params.external_id = data.external_id; }
  if (data.external_source !== undefined) { setClauses.push('external_source = @external_source'); params.external_source = data.external_source; }
  if (data.updated_by_agent_id !== undefined) { setClauses.push('updated_by_agent_id = @updated_by_agent_id'); params.updated_by_agent_id = data.updated_by_agent_id; }
  if (data.status !== undefined) { setClauses.push('status = @status'); params.status = data.status; }
  if (data.next_meeting_at !== undefined) { setClauses.push('next_meeting_at = @next_meeting_at'); params.next_meeting_at = data.next_meeting_at; }
  if (data.archived !== undefined) { setClauses.push('archived = @archived'); params.archived = data.archived ? 1 : 0; }

  db.prepare(`UPDATE deals SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

  // Log changes for each field that actually changed
  const trackableFields = [
    'name', 'company', 'stage', 'thesis', 'contacts', 'source_agent_id',
    'source_channel_id', 'round', 'amount', 'lead_investor', 'notes',
    'external_id', 'external_source', 'status', 'next_meeting_at', 'archived',
  ] as const;
  const agentId = data.updated_by_agent_id ?? current.updated_by_agent_id;
  for (const field of trackableFields) {
    if (data[field] === undefined) continue;
    const newVal = field === 'archived' ? String(data[field] ? 1 : 0) : (data[field] as string | null);
    const oldVal = current[field] != null ? String(current[field]) : null;
    if (oldVal !== (newVal ?? null)) {
      logChange(id, field, oldVal, newVal ?? null, 'update', agentId);
    }
  }

  const rawDeal = db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as any | null;
  return rawDeal ? { ...rawDeal, archived: Boolean(rawDeal.archived) } as Deal : null;
}

export function deleteDeal(id: string, agentId?: string | null): boolean {
  const db = getDealDb();
  const current = db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as any | null;
  if (!current) return false;

  // Log deletion for key fields before removing the row
  const fields = ['name', 'company', 'stage', 'status'] as const;
  for (const field of fields) {
    if (current[field] != null) {
      logChange(id, field, String(current[field]), null, 'delete', agentId ?? current.updated_by_agent_id);
    }
  }

  const result = db.prepare('DELETE FROM deals WHERE id = ?').run(id);
  return result.changes > 0;
}

export function resolveDeal(token: string): Deal | null {
  const db = getDealDb();
  const shortMatch = token.match(/^D#?(\d+)$/i) ?? token.match(/^(\d+)$/);
  let rawDeal: any | null;
  
  if (shortMatch) {
    const n = parseInt(shortMatch[1], 10);
    rawDeal = db.prepare('SELECT * FROM deals WHERE shortId = ?').get(n) as any | null;
  } else {
    rawDeal = db.prepare('SELECT * FROM deals WHERE id LIKE ?').get(token + '%') as any | null;
  }

  return rawDeal ? { ...rawDeal, archived: Boolean(rawDeal.archived) } as Deal : null;
}

export function getDealChanges(
  dealId: string,
  filters?: { agent_id?: string; field?: string },
): DealChange[] {
  const db = getDealDb();
  const conditions: string[] = ['deal_id = @deal_id'];
  const params: Record<string, string> = { deal_id: dealId };

  if (filters?.agent_id) {
    conditions.push('agent_id = @agent_id');
    params.agent_id = filters.agent_id;
  }
  if (filters?.field) {
    conditions.push('field = @field');
    params.field = filters.field;
  }

  return db
    .prepare(`SELECT * FROM deal_changes WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`)
    .all(params) as DealChange[];
}
