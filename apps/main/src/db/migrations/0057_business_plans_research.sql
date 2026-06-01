-- 0057_business_plans_research.sql — Competitor research. Stores the CEO's web research
-- (real competitors + differentiation) on the business plan, decided at genesis. Nullable:
-- plans created before this (and any plan where the CEO omitted research) have no block.

ALTER TABLE business_plans ADD COLUMN research_json TEXT;
