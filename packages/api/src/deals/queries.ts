import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { dealChanges, deals, type Db } from '@blather/db';

export type DealStage = 'sourcing' | 'dd' | 'pass' | 'move' | 'portfolio';
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
  shortId: number;
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

type DealInput = {
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
};

function mapDeal(row: typeof deals.$inferSelect): Deal {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    stage: row.stage,
    thesis: row.thesis,
    contacts: row.contacts,
    source_agent_id: row.sourceAgentId,
    source_channel_id: row.sourceChannelId,
    round: row.round,
    amount: row.amount,
    lead_investor: row.leadInvestor,
    notes: row.notes,
    shortId: row.shortId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    external_id: row.externalId,
    external_source: row.externalSource,
    updated_by_agent_id: row.updatedByAgentId,
    status: row.status,
    next_meeting_at: row.nextMeetingAt,
    archived: row.archived,
  };
}

function mapChange(row: typeof dealChanges.$inferSelect): DealChange {
  return {
    id: row.id,
    deal_id: row.dealId,
    agent_id: row.agentId,
    field: row.field,
    old_value: row.oldValue,
    new_value: row.newValue,
    change_type: row.changeType,
    created_at: row.createdAt.toISOString(),
  };
}

async function logChange(
  db: any,
  dealId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  changeType: string,
  agentId?: string | null,
): Promise<void> {
  await db.insert(dealChanges).values({
    dealId,
    agentId: agentId ?? null,
    field,
    oldValue,
    newValue,
    changeType,
  });
}

export async function listDeals(db: Db, filters?: {
  stage?: DealStage;
  status?: DealStatus;
  name?: string;
  includeArchived?: boolean;
}): Promise<Deal[]> {
  const conditions = [];
  if (!filters?.includeArchived) conditions.push(eq(deals.archived, false));
  if (filters?.stage) conditions.push(eq(deals.stage, filters.stage));
  if (filters?.status) conditions.push(eq(deals.status, filters.status));
  if (filters?.name) conditions.push(ilike(deals.name, `%${filters.name}%`));
  const rows = await db.select().from(deals).where(and(...conditions)).orderBy(desc(deals.createdAt));
  return rows.map(mapDeal);
}

export async function getDeal(db: Db, id: string): Promise<Deal | null> {
  const [row] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  return row ? mapDeal(row) : null;
}

export async function createDeal(db: Db, data: DealInput & { name: string }): Promise<Deal> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(deals).values({
      name: data.name,
      company: data.company ?? null,
      stage: data.stage ?? 'sourcing',
      thesis: data.thesis ?? null,
      contacts: data.contacts ?? null,
      sourceAgentId: data.source_agent_id ?? null,
      sourceChannelId: data.source_channel_id ?? null,
      round: data.round ?? null,
      amount: data.amount ?? null,
      leadInvestor: data.lead_investor ?? null,
      notes: data.notes ?? null,
      externalId: data.external_id ?? null,
      externalSource: data.external_source ?? null,
      updatedByAgentId: data.updated_by_agent_id ?? null,
      status: data.status ?? 'active',
      nextMeetingAt: data.next_meeting_at ?? null,
      archived: data.archived ?? false,
    }).returning();

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
      archived: data.archived ? '1' : '0',
    };
    for (const [field, value] of Object.entries(createdFields)) {
      if (value !== null) await logChange(tx, row.id, field, null, value, 'create', data.source_agent_id);
    }
    return mapDeal(row);
  });
}

export async function updateDeal(db: Db, id: string, data: DealInput): Promise<Deal | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
    if (!current) return null;

    const values: Partial<typeof deals.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) values.name = data.name;
    if (data.company !== undefined) values.company = data.company;
    if (data.stage !== undefined) values.stage = data.stage;
    if (data.thesis !== undefined) values.thesis = data.thesis;
    if (data.contacts !== undefined) values.contacts = data.contacts;
    if (data.source_agent_id !== undefined) values.sourceAgentId = data.source_agent_id;
    if (data.source_channel_id !== undefined) values.sourceChannelId = data.source_channel_id;
    if (data.round !== undefined) values.round = data.round;
    if (data.amount !== undefined) values.amount = data.amount;
    if (data.lead_investor !== undefined) values.leadInvestor = data.lead_investor;
    if (data.notes !== undefined) values.notes = data.notes;
    if (data.external_id !== undefined) values.externalId = data.external_id;
    if (data.external_source !== undefined) values.externalSource = data.external_source;
    if (data.updated_by_agent_id !== undefined) values.updatedByAgentId = data.updated_by_agent_id;
    if (data.status !== undefined) values.status = data.status;
    if (data.next_meeting_at !== undefined) values.nextMeetingAt = data.next_meeting_at;
    if (data.archived !== undefined) values.archived = data.archived;

    const trackable: Array<[keyof DealInput, keyof typeof current]> = [
      ['name', 'name'], ['company', 'company'], ['stage', 'stage'], ['thesis', 'thesis'],
      ['contacts', 'contacts'], ['source_agent_id', 'sourceAgentId'], ['source_channel_id', 'sourceChannelId'],
      ['round', 'round'], ['amount', 'amount'], ['lead_investor', 'leadInvestor'], ['notes', 'notes'],
      ['external_id', 'externalId'], ['external_source', 'externalSource'], ['status', 'status'],
      ['next_meeting_at', 'nextMeetingAt'], ['archived', 'archived'],
    ];
    const agentId = data.updated_by_agent_id ?? current.updatedByAgentId;
    for (const [inputKey, rowKey] of trackable) {
      if (data[inputKey] === undefined) continue;
      const incoming = data[inputKey];
      const newValue = inputKey === 'archived' ? (incoming ? '1' : '0') : incoming == null ? null : String(incoming);
      const old = current[rowKey];
      const oldValue = inputKey === 'archived' ? (old ? '1' : '0') : old == null ? null : String(old);
      if (oldValue !== newValue) await logChange(tx, id, inputKey, oldValue, newValue, 'update', agentId);
    }

    const [updated] = await tx.update(deals).set(values).where(eq(deals.id, id)).returning();
    return mapDeal(updated);
  });
}

export async function deleteDeal(db: Db, id: string, agentId?: string | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(deals).where(eq(deals.id, id)).limit(1);
    if (!current) return false;
    for (const field of ['name', 'company', 'stage', 'status'] as const) {
      if (current[field] != null) {
        await logChange(tx, id, field, String(current[field]), null, 'delete', agentId ?? current.updatedByAgentId);
      }
    }
    const deleted = await tx.delete(deals).where(eq(deals.id, id)).returning({ id: deals.id });
    return deleted.length > 0;
  });
}

export async function resolveDeal(db: Db, token: string): Promise<Deal | null> {
  const shortMatch = token.match(/^D#?(\d+)$/i) ?? token.match(/^(\d+)$/);
  const [row] = shortMatch
    ? await db.select().from(deals).where(eq(deals.shortId, Number.parseInt(shortMatch[1], 10))).limit(1)
    : await db.select().from(deals).where(sql`${deals.id}::text LIKE ${`${token}%`}`).orderBy(asc(deals.createdAt)).limit(1);
  return row ? mapDeal(row) : null;
}

export async function getDealChanges(
  db: Db,
  dealId: string,
  filters?: { agent_id?: string; field?: string },
): Promise<DealChange[]> {
  const conditions = [eq(dealChanges.dealId, dealId)];
  if (filters?.agent_id) conditions.push(eq(dealChanges.agentId, filters.agent_id));
  if (filters?.field) conditions.push(eq(dealChanges.field, filters.field));
  const rows = await db.select().from(dealChanges).where(and(...conditions)).orderBy(desc(dealChanges.createdAt));
  return rows.map(mapChange);
}
