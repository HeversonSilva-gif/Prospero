-- 0052_business_plans_pricing.sql — P5.2. Adds the CEO's structured charge model
-- (one_time/subscription/combo + items + rationale) to the business plan, decided
-- at genesis and enacted in Stripe on approval. Nullable: plans created before
-- P5.2 (and any plan where the CEO omitted pricing) have no model.

ALTER TABLE business_plans ADD COLUMN pricing_json TEXT;
