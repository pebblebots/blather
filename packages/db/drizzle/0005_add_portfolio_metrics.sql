CREATE TABLE IF NOT EXISTS "portfolio_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"fund" text NOT NULL,
	"reporting_date" date NOT NULL,
	"revenue_arr_usd" numeric NOT NULL,
	"revenue_as_of_date" date,
	"headcount" integer,
	"runway_months" numeric,
	"yoy_growth_pct" numeric,
	"last_round_size_usd" numeric,
	"last_round_valuation_usd" numeric,
	"last_round_date" date,
	"last_round_type" text,
	"key_milestone_text" varchar(500),
	"next_fundraise_timing" text,
	"contact_email" text,
	"permission_to_share" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"confidence" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_metrics_fund_idx" ON "portfolio_metrics" USING btree ("fund");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_metrics_company_name_idx" ON "portfolio_metrics" USING btree ("company_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_metrics_reporting_date_idx" ON "portfolio_metrics" USING btree ("reporting_date");
