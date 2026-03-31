-- Signal entity tracker tables (T#52)

DO $$ BEGIN
  CREATE TYPE "signal_entity_type" AS ENUM('company', 'person');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "signal_source" AS ENUM('arxiv', 'twitter', 'opencorporates', 'manual');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "signal_type" AS ENUM('paper', 'hiring', 'funding', 'corp_filing', 'social_mention');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "signal_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" "signal_entity_type" NOT NULL,
  "name" text NOT NULL,
  "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "signal_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL REFERENCES "signal_entities"("id") ON DELETE CASCADE,
  "source" "signal_source" NOT NULL,
  "signal_type" "signal_type" NOT NULL,
  "raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "confidence" real NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "signal_convergences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL REFERENCES "signal_entities"("id") ON DELETE CASCADE,
  "signal_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "convergence_score" real NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  "posted_to_sourcing" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "signal_events_entity_idx" ON "signal_events" ("entity_id");
CREATE INDEX IF NOT EXISTS "signal_events_observed_idx" ON "signal_events" ("observed_at");
CREATE INDEX IF NOT EXISTS "signal_convergences_entity_idx" ON "signal_convergences" ("entity_id");
CREATE INDEX IF NOT EXISTS "signal_convergences_unposted_idx" ON "signal_convergences" ("posted_to_sourcing");
