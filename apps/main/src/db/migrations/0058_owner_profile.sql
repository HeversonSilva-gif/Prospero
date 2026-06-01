-- 0058_owner_profile.sql — Personality memory. A short profile of the OWNER (how they
-- communicate, what they value, risk appetite) captured at genesis. Lives on the plan
-- (reviewable) and is copied to the company on approval (the read path for business-context).
ALTER TABLE business_plans ADD COLUMN owner_profile TEXT;
ALTER TABLE companies ADD COLUMN owner_profile TEXT;
