-- 0038_inbox_ceo_kinds.sql — add the CEO-approval inbox kinds.
-- Migration 0037 added `manager_request` and `ceo_decision` to the TypeScript
-- InboxKind union but NOT to the inbox_items CHECK constraint (rebuilt by 0036),
-- so inserting those kinds threw "CHECK constraint failed" at runtime. SQLite
-- cannot ALTER a CHECK, so we recreate inbox_items (defer_foreign_keys pattern,
-- mirroring 0036) with the two kinds added.

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
      'ceo_decision'
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
