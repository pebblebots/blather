CREATE TYPE "public"."channel_type" AS ENUM('public', 'private', 'dm');--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "channel_type" "channel_type" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" DROP COLUMN "is_private";