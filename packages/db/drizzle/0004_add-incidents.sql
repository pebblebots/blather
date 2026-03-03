CREATE TYPE "public"."incident_severity" AS ENUM('critical', 'warning', 'info');
CREATE TYPE "public"."incident_status" AS ENUM('open', 'acked', 'resolved');

CREATE TABLE "incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "title" text NOT NULL,
  "severity" "incident_severity" DEFAULT 'warning' NOT NULL,
  "status" "incident_status" DEFAULT 'open' NOT NULL,
  "opened_by" uuid REFERENCES "users"("id"),
  "acked_by" uuid REFERENCES "users"("id"),
  "resolved_by" uuid REFERENCES "users"("id"),
  "resolution" text,
  "channel_id" uuid REFERENCES "channels"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "acked_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
