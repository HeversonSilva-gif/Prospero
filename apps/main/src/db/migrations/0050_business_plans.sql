-- 0050_business_plans.sql — P4.1 business genesis. The CEO proposes a runnable,
-- AI-feasible business; MAIN critiques it (feasibility + quality) before
-- surfacing. Mirrors org_plans' critiquing→proposed lifecycle. New table only,
-- plus two nullable brand-identity columns on companies (persisted on approval).

CREATE TABLE business_plans (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  proposed_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  concept              TEXT NOT NULL,
  monetization_json    TEXT NOT NULL,
  marketing_json       TEXT NOT NULL,
  identity_json        TEXT NOT NULL,
  dropped_json         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'critiquing'
                         CHECK (status IN ('critiquing','proposed','approved','rejected','superseded')),
  user_feedback        TEXT,
  proposed_at          INTEGER NOT NULL,
  decided_at           INTEGER
);
CREATE INDEX idx_business_plans_company_status ON business_plans(company_id, status);

ALTER TABLE companies ADD COLUMN brand_voice TEXT;
ALTER TABLE companies ADD COLUMN proposed_x_handle TEXT;
