ALTER TABLE portfolio_metrics ADD CONSTRAINT portfolio_metrics_company_fund_date_uq UNIQUE (company_name, fund, reporting_date);
