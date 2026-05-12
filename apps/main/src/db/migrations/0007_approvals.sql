-- 0007_approvals.sql — M7.5 PR-B decoupled approvals
-- Splits approval semantics out of inbox_items.payload_json so future kinds
-- (code_review, hire_confirm, budget_override, goal_plan...) get a typed
-- payload, an audit history, and shared queries across the app.
-- inbox_items.approval_id is a pointer; legacy inline rows continue to work
-- via dual-format handling in inbox-handlers.

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired')),
  decided_by TEXT,
  decision_note TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_approvals_agent ON approvals(agent_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_kind ON approvals(kind);

ALTER TABLE inbox_items ADD COLUMN approval_id TEXT REFERENCES approvals(id) ON DELETE SET NULL;
