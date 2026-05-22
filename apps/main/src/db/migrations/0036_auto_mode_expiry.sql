-- 0036_auto_mode_expiry.sql — P2-C: Governança de autonomia
-- Adds `auto_mode_set_at` to `agents`: timestamp (ms) when mode was last set
-- to 'auto'. NULL means the agent has never been put in auto mode since this
-- migration, or is currently in supervised mode.
-- For existing agents already in 'auto', we use `updated_at` as a safe
-- approximation — they will expire no later than 24h from migration run.
--
-- Also adds the `auto_mode_expired` inbox kind (SQLite cannot ALTER a CHECK
-- constraint, so inbox_items is recreated using the defer_foreign_keys pattern).

ALTER TABLE agents ADD COLUMN auto_mode_set_at INTEGER;

-- Seed existing auto-mode agents so the expiry check has a baseline.
UPDATE agents SET auto_mode_set_at = updated_at WHERE mode = 'auto';

PRAGMA defer_foreign_keys = 1;

CREATE TABLE inbox_items_new (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN (
      'approval',
      'completed',
      'suggestion',
      'error',
      'security_alert',
      'goal_proposed',
      'goal_executing',
      'goal_error',
      'agent_unresponsive',
      'skill_candidate_pending',
      'skill_promotion_requested',
      'goal_retrospective_ready',
      'memory_review_needed',
      'org_proposed',
      'budget_warning',
      'verification_failed',
      'verification_review',
      'security_zone_blocked',
      'trust_promotion_suggested',
      'auto_mode_expired'
    )),
  actor_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT,
  requires_action INTEGER NOT NULL DEFAULT 0
    CHECK (requires_action IN (0,1)),
  approval_id TEXT REFERENCES approvals(id) ON DELETE SET NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

INSERT INTO inbox_items_new
  (id, company_id, kind, actor_id, title, preview, payload_json,
   requires_action, approval_id, read_at, created_at)
SELECT
  id, company_id, kind, actor_id, title, preview, payload_json,
  requires_action, approval_id, read_at, created_at
FROM inbox_items;

DROP TABLE inbox_items;
ALTER TABLE inbox_items_new RENAME TO inbox_items;

CREATE INDEX IF NOT EXISTS idx_inbox_company_unread
  ON inbox_items(company_id, read_at);

-- Index to make the expiry-check query fast: finds all auto agents whose
-- timer has elapsed without a full table scan.
CREATE INDEX IF NOT EXISTS idx_agents_auto_mode_expiry
  ON agents(mode, auto_mode_set_at)
  WHERE mode = 'auto';
