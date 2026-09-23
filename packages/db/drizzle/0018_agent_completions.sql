-- Model-call provenance for clankers (evals-and-finetuning spec, Phase 0).
-- Prompt/completion bodies live in the object store; rows carry refs only.

CREATE TABLE "agent_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"session_key" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"prompt_ref" text,
	"completion_ref" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"cost_usd" numeric,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "agent_completions_agent_created_idx" ON "agent_completions" USING btree ("agent_user_id", "created_at");--> statement-breakpoint
CREATE INDEX "agent_completions_session_key_idx" ON "agent_completions" USING btree ("session_key");--> statement-breakpoint
CREATE INDEX "agent_completions_model_idx" ON "agent_completions" USING btree ("model");
