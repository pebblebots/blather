-- Move the SQLite-backed task and deal subsystems onto the primary Postgres database.

ALTER TABLE "tasks" ADD COLUMN "claimed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completion_artifact" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_claimed_by_id_users_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "tasks" SET "source_channel_id" = NULL WHERE "source_channel_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "channels" WHERE "channels"."id" = "tasks"."source_channel_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_channel_id_channels_id_fk" FOREIGN KEY ("source_channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Legacy production used PostgreSQL's default constraint name, while fresh
-- Drizzle databases use the generated name below. Drop either shape before
-- installing the canonical cascade behavior.
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_user_id_fkey";--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Replace the MAX(short_id) trigger strategy with a concurrency-safe sequence.
CREATE SEQUENCE IF NOT EXISTS "tasks_short_id_seq";--> statement-breakpoint
SELECT setval('tasks_short_id_seq', COALESCE((SELECT MAX("short_id") FROM "tasks"), 0) + 1, false);--> statement-breakpoint
UPDATE "tasks" SET "short_id" = nextval('tasks_short_id_seq') WHERE "short_id" IS NULL;--> statement-breakpoint
SELECT setval('tasks_short_id_seq', COALESCE((SELECT MAX("short_id") FROM "tasks"), 0) + 1, false);--> statement-breakpoint
ALTER SEQUENCE "tasks_short_id_seq" OWNED BY "tasks"."short_id";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "short_id" SET DEFAULT nextval('tasks_short_id_seq');--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "short_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_short_id_unique" UNIQUE("short_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_id_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "task_comments_task_id_created_at_idx" ON "task_comments" USING btree ("task_id", "created_at");--> statement-breakpoint

CREATE TYPE "public"."deal_stage" AS ENUM('sourcing', 'dd', 'pass', 'move', 'portfolio');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('active', 'watchlist', 'zombie', 'inactive', 'exited');--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"stage" "deal_stage" DEFAULT 'sourcing' NOT NULL,
	"thesis" text,
	"contacts" text,
	"source_agent_id" text,
	"source_channel_id" text,
	"round" text,
	"amount" text,
	"lead_investor" text,
	"notes" text,
	"short_id" serial NOT NULL,
	"external_id" text,
	"external_source" text,
	"updated_by_agent_id" text,
	"status" "deal_status" DEFAULT 'active' NOT NULL,
	"next_meeting_at" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_short_id_unique" UNIQUE("short_id")
);--> statement-breakpoint
CREATE TABLE "deal_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"agent_id" text,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"change_type" text DEFAULT 'update' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "deals_stage_idx" ON "deals" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deals_created_at_idx" ON "deals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deal_changes_deal_id_created_at_idx" ON "deal_changes" USING btree ("deal_id", "created_at");
