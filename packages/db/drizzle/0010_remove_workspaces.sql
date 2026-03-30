-- Remove workspace concept entirely: single-tenant flat namespace

CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'member';--> statement-breakpoint
UPDATE "users" SET "role" = 'owner'
WHERE "id" IN (
  SELECT "user_id" FROM "workspace_members" WHERE "role" = 'owner'
);--> statement-breakpoint
ALTER TABLE "channels" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "incidents" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "huddles" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "agent_activity_log" DROP COLUMN "workspace_id";--> statement-breakpoint
DROP TABLE "workspace_members";--> statement-breakpoint
DROP TABLE "workspaces";--> statement-breakpoint
DROP TYPE "workspace_role";--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_slug_unique" UNIQUE ("slug");
