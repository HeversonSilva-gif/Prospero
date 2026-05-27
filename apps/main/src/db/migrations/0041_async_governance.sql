-- 0041_async_governance.sql — v0.1.19 async governance (V2 Tier 2)
-- Adds bounce_count to approvals so a request that stays in the human inbox
-- past TTL gets re-routed to the CEO once with "human didn't answer, you
-- decide" prompt. A second timeout there default-denies. Also adds the
-- governance_config table keyed by company.

ALTER TABLE approvals ADD COLUMN bounce_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS governance_config (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  quiet_hours_json TEXT NOT NULL,
  policies_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
