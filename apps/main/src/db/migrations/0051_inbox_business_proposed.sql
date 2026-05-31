-- 0051_inbox_business_proposed.sql — P4.1 business genesis. The CEO's proposed
-- business surfaces as an inbox card the owner approves/refines. SQLite cannot
-- ALTER a CHECK constraint — recreate inbox_items adding the 'business_proposed'
-- kind (same pattern as 0044/0048: defer_foreign_keys + create-new/copy/drop/rename).

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
      'auto_mode_expired',
      'manager_request',
      'ceo_decision',
      'skill_consolidation_proposed',
      'business_proposed'
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
SELECT id, company_id, kind, actor_id, title, preview, payload_json,
   requires_action, approval_id, read_at, created_at
FROM inbox_items;

DROP TABLE inbox_items;
ALTER TABLE inbox_items_new RENAME TO inbox_items;
CREATE INDEX IF NOT EXISTS idx_inbox_company_unread ON inbox_items(company_id, read_at);
