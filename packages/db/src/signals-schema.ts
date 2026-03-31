import { pgTable, uuid, text, jsonb, real, timestamp, boolean, pgEnum, index } from 'drizzle-orm/pg-core';

export const signalEntityTypeEnum = pgEnum('signal_entity_type', ['company', 'person']);
export const signalSourceEnum = pgEnum('signal_source', ['arxiv', 'twitter', 'opencorporates', 'manual']);
export const signalTypeEnum = pgEnum('signal_type', ['paper', 'hiring', 'funding', 'corp_filing', 'social_mention']);

export const signalEntities = pgTable('signal_entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: signalEntityTypeEnum('entity_type').notNull(),
  name: text('name').notNull(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const signalEvents = pgTable('signal_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityId: uuid('entity_id').notNull().references(() => signalEntities.id, { onDelete: 'cascade' }),
  source: signalSourceEnum('source').notNull(),
  signalType: signalTypeEnum('signal_type').notNull(),
  rawData: jsonb('raw_data').$type<Record<string, unknown>>().notNull().default({}),
  confidence: real('confidence').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  entityIdx: index('signal_events_entity_idx').on(t.entityId),
  observedIdx: index('signal_events_observed_idx').on(t.observedAt),
}));

export const signalConvergences = pgTable('signal_convergences', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityId: uuid('entity_id').notNull().references(() => signalEntities.id, { onDelete: 'cascade' }),
  signalEventIds: jsonb('signal_event_ids').$type<string[]>().notNull().default([]),
  convergenceScore: real('convergence_score').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  postedToSourcing: boolean('posted_to_sourcing').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  entityIdx: index('signal_convergences_entity_idx').on(t.entityId),
  unpostedIdx: index('signal_convergences_unposted_idx').on(t.postedToSourcing),
}));
