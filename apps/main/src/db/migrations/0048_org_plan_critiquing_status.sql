-- 0048_org_plan_critiquing_status.sql — P2 peça 2: a submitted org plan starts
-- 'critiquing' (hidden from getCurrentForCompany) while MAIN critiques its
-- charters, then flips to 'proposed' (or stays 'critiquing' on revise). SQLite
-- cannot ALTER a CHECK constraint — recreate org_plans (same pattern as 0025).

PRAGMA defer_foreign_keys = 1;

CREATE TABLE org_plans_new (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  proposed_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  summary              TEXT NOT NULL,
  roles_json           TEXT NOT NULL,
  agents_json          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'critiquing'
                         CHECK (status IN ('critiquing','proposed','approved','rejected','superseded')),
  user_feedback        TEXT,
  proposed_at          INTEGER NOT NULL,
  decided_at           INTEGER
);

INSERT INTO org_plans_new
  (id, company_id, proposed_by_agent_id, summary, roles_json, agents_json,
   status, user_feedback, proposed_at, decided_at)
SELECT
  id, company_id, proposed_by_agent_id, summary, roles_json, agents_json,
  status, user_feedback, proposed_at, decided_at
FROM org_plans;

DROP TABLE org_plans;
ALTER TABLE org_plans_new RENAME TO org_plans;
CREATE INDEX idx_org_plans_company_status ON org_plans(company_id, status);
