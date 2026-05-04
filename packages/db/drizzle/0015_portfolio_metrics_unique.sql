-- Add missing UNIQUE constraint for portfolio_metrics.
-- Schema declared companyFundDateUq = unique().on(companyName, fund, reportingDate),
-- but the 0005 migration only created indexes, not the constraint. The ON CONFLICT
-- clause in drizzle inserts requires a UNIQUE index/constraint; without it, inserts
-- 500 with Postgres 42P10 (invalid_column_reference, routine=infer_arbiter_indexes).
-- Fixes T#174.

-- First drop any duplicate rows that would violate the constraint
-- (shouldn't exist in any live DB but be defensive)
DELETE FROM "portfolio_metrics" a USING "portfolio_metrics" b
  WHERE a.ctid < b.ctid
    AND a.company_name = b.company_name
    AND a.fund = b.fund
    AND a.reporting_date = b.reporting_date;
--> statement-breakpoint
ALTER TABLE "portfolio_metrics" ADD CONSTRAINT "portfolio_metrics_company_fund_date_uq"
  UNIQUE ("company_name", "fund", "reporting_date");
