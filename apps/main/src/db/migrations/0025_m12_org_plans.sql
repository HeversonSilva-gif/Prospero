-- 0025_m12_org_plans.sql — M12 PR-D2: the CEO org architect.
-- org_plans  — one row per submit_org_plan proposal (no persistent parent).
-- inbox_items is recreated to add the `org_proposed` kind (SQLite cannot ALTER
-- a CHECK constraint — same recreate pattern as migrations 0019-0022).

CREATE TABLE org_plans (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  proposed_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  summary              TEXT NOT NULL,
  roles_json           TEXT NOT NULL,
  agents_json          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'proposed'
                         CHECK (status IN ('proposed','approved','rejected','superseded')),
  user_feedback        TEXT,
  proposed_at          INTEGER NOT NULL,
  decided_at           INTEGER
);
CREATE INDEX idx_org_plans_company_status ON org_plans(company_id, status);

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
      'org_proposed'
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
