import { getDealDb } from './db.js';

export type DealStage = 'sourcing' | 'dd' | 'pass' | 'move' | 'portfolio';

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
}

const VALID_STAGES: DealStage[] = ['sourcing', 'dd', 'pass', 'move', 'portfolio'];

export function listDeals(filters?: {
  stage?: DealStage;
  name?: string;
}): Deal[] {
  const db = getDealDb();
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.stage) {
    conditions.push('stage = @stage');
    params.stage = filters.stage;
  }
  if (filters?.name) {
    conditions.push('lower(name) LIKE @name');
    params.name = `%${filters.name.toLowerCase()}%`;
  }

  if (conditions.length === 0) {
    return db.prepare('SELECT * FROM deals ORDER BY createdAt DESC').all() as Deal[];
  }

  return db
    .prepare(`SELECT * FROM deals WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC`)
    .all(params) as Deal[];
}

export function getDeal(id: string): Deal | null {
  return getDealDb().prepare('SELECT * FROM deals WHERE id = ?').get(id) as Deal | null;
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
}): Deal {
  const db = getDealDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const seq = db.prepare('INSERT INTO deal_short_id_seq DEFAULT VALUES').run();
  const shortId = Number(seq.lastInsertRowid);

  db.prepare(`
    INSERT INTO deals (id, name, company, stage, thesis, contacts, source_agent_id, source_channel_id, round, amount, lead_investor, notes, shortId, createdAt, updatedAt)
    VALUES (@id, @name, @company, @stage, @thesis, @contacts, @source_agent_id, @source_channel_id, @round, @amount, @lead_investor, @notes, @shortId, @createdAt, @updatedAt)
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
  });

  return db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as Deal;
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
  },
): Deal | null {
  const db = getDealDb();
  const now = new Date().toISOString();

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

  db.prepare(`UPDATE deals SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  return db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as Deal | null;
}

export function deleteDeal(id: string): boolean {
  const result = getDealDb().prepare('DELETE FROM deals WHERE id = ?').run(id);
  return result.changes > 0;
}

export function resolveDeal(token: string): Deal | null {
  const db = getDealDb();
  const shortMatch = token.match(/^D#?(\d+)$/i) ?? token.match(/^(\d+)$/);
  if (shortMatch) {
    const n = parseInt(shortMatch[1], 10);
    return db.prepare('SELECT * FROM deals WHERE shortId = ?').get(n) as Deal | null;
  }
  return db.prepare('SELECT * FROM deals WHERE id LIKE ?').get(token + '%') as Deal | null;
}
