-- M13 PR-B1: issue_criteria join + verification_failed/verification_review inbox kinds.
--
-- issue_criteria links an issue to the ISCs it advances (spec §5.3) — used for
-- coverage hints and agent focus. The verification engine itself checks ALL of
-- a goal's goal_criteria and does not depend on this join.
--
-- SQLite cannot ALTER a CHECK constraint, so inbox_items is recreated to add
-- the two verification kinds. defer_foreign_keys per the M8 PR-A convention.

PRAGMA defer_foreign_keys = 1;

CREATE TABLE issue_criteria (
  issue_id      TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  criterion_id  TEXT NOT NULL REFERENCES goal_criteria(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, criterion_id)
);

CREATE INDEX idx_issue_criteria_criterion ON issue_criteria(criterion_id);

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
      'verification_review'
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
