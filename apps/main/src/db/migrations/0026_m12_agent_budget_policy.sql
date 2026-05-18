-- 0026_m12_agent_budget_policy.sql — M12 PR-E2: per-agent Budget + Run Policy.
-- 6 new columns on `agents`:
--   budget_tokens_limit / budget_usd_limit — per-agent caps (NULL = unset);
--     budget_usd_limit is in cents (consistent with cost_cents_estimate).
--   budget_period        — 'daily' | 'monthly' rollover window.
--   budget_warned_period — dedup key for the 80% Inbox warning (internal).
--   can_hire / can_assign — Run Policy sub-toggles of delegation/issues.
-- inbox_items is recreated to add the `budget_warning` kind — SQLite cannot
-- ALTER a CHECK constraint (same recreate pattern as migrations 0019-0025).

ALTER TABLE agents ADD COLUMN budget_tokens_limit INTEGER;
ALTER TABLE agents ADD COLUMN budget_usd_limit INTEGER;
ALTER TABLE agents ADD COLUMN budget_period TEXT NOT NULL DEFAULT 'daily'
  CHECK (budget_period IN ('daily','monthly'));
ALTER TABLE agents ADD COLUMN budget_warned_period TEXT;
ALTER TABLE agents ADD COLUMN can_hire INTEGER NOT NULL DEFAULT 1
  CHECK (can_hire IN (0,1));
ALTER TABLE agents ADD COLUMN can_assign INTEGER NOT NULL DEFAULT 1
  CHECK (can_assign IN (0,1));

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
      'budget_warning'
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
