import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, pgEnum, unique, integer, date, decimal, index } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['owner', 'admin', 'member']);
export const channelTypeEnum = pgEnum('channel_type', ['public', 'private', 'dm']);

// ── Users ──

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  avatarUrl: text('avatar_url'),
  isAgent: boolean('is_agent').notNull().default(false),
  role: userRoleEnum('role').notNull().default('member'),
  voice: varchar('voice', { length: 255 }),
  bio: text('bio'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Magic Link Tokens ──

export const magicTokens = pgTable('magic_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  code: varchar('code', { length: 10 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── API Keys ──

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// ── Channels ──

export const channels = pgTable('channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  channelType: channelTypeEnum('channel_type').notNull().default('public'),
  isDefault: boolean('is_default').notNull().default(false),
  topic: text('topic'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archived: boolean('archived').notNull().default(false),
});

// ── Channel Members ──

export const channelMembers = pgTable('channel_members', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  muted: boolean('muted').notNull().default(false),
}, (t) => ([
  unique('uq_channel_members_channel_user').on(t.channelId, t.userId),
]));

// ── Messages ──

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  attachments: jsonb("attachments").$type<{ url: string; filename: string; contentType: string; size: number }[]>().default([]),
  threadId: uuid('thread_id'),
  idempotencyKey: uuid('idempotency_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  canvas: jsonb('canvas'),
}, (table) => [
  unique('uq_messages_user_idempotency').on(table.userId, table.idempotencyKey),
]);

// ── Reactions ──

export const reactions = pgTable('reactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: varchar('emoji', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Events ──

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 64 }).notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Channel Reads (unread tracking) ──

export const channelReads = pgTable('channel_reads', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unq: unique().on(t.channelId, t.userId),
}));


// ── Incident Severity & Status Enums ──

export const incidentSeverityEnum = pgEnum("incident_severity", ["critical", "warning", "info"]);
export const incidentStatusEnum = pgEnum("incident_status", ["open", "acked", "resolved"]);

// ── Incidents ──

export const incidents = pgTable("incidents", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  severity: incidentSeverityEnum("severity").notNull().default("warning"),
  status: incidentStatusEnum("status").notNull().default("open"),
  openedBy: uuid("opened_by").references(() => users.id, { onDelete: "set null" }),
  ackedBy: uuid("acked_by").references(() => users.id, { onDelete: "set null" }),
  resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolution: text("resolution"),
  channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Huddles ──

export const huddleStatusEnum = pgEnum('huddle_status', ['active', 'ended']);

export const huddles = pgTable('huddles', {
  id: uuid('id').defaultRandom().primaryKey(),
  topic: text('topic').notNull(),
  status: huddleStatusEnum('status').notNull().default('active'),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  maxDurationMs: integer('max_duration_ms').notNull().default(1800000),
});

export const huddleParticipants = pgTable('huddle_participants', {
  huddleId: uuid('huddle_id').notNull().references(() => huddles.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
});

// ── Portfolio Metrics ──

export const portfolioMetrics = pgTable('portfolio_metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyName: text('company_name').notNull(),
  fund: text('fund').notNull(),
  reportingDate: date('reporting_date').notNull(),
  revenueArrUsd: decimal('revenue_arr_usd').notNull(),
  revenueAsOfDate: date('revenue_as_of_date'),
  headcount: integer('headcount'),
  runwayMonths: decimal('runway_months'),
  yoyGrowthPct: decimal('yoy_growth_pct'),
  lastRoundSizeUsd: decimal('last_round_size_usd'),
  lastRoundValuationUsd: decimal('last_round_valuation_usd'),
  lastRoundDate: date('last_round_date'),
  lastRoundType: text('last_round_type'),
  keyMilestoneText: varchar('key_milestone_text', { length: 500 }),
  nextFundraiseTiming: text('next_fundraise_timing'),
  contactEmail: text('contact_email'),
  permissionToShare: boolean('permission_to_share').notNull().default(false),
  source: text('source').notNull(),
  confidence: decimal('confidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  fundIdx: index('portfolio_metrics_fund_idx').on(t.fund),
  companyNameIdx: index('portfolio_metrics_company_name_idx').on(t.companyName),
  reportingDateIdx: index('portfolio_metrics_reporting_date_idx').on(t.reportingDate),
  companyFundDateUq: unique('portfolio_metrics_company_fund_date_uq').on(t.companyName, t.fund, t.reportingDate),
}));


// ── Agent Activity Log ──

export const agentActivityLog = pgTable('agent_activity_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentUserId: uuid('agent_user_id').notNull(),
  sessionKey: text('session_key').notNull().default(''),
  action: text('action').notNull(),
  targetChannelId: uuid('target_channel_id'),
  targetMessageId: uuid('target_message_id'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
