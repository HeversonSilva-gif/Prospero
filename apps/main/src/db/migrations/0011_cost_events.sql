-- M8 PR-A: cost tracking foundation.
--
-- Drops the legacy costs_log table (declared in 0001 but never written) and
-- replaces it with cost_events — adapter-aware, with issue_id linkage for
-- per-issue budget enforcement, and cost_cents_estimate snapshotted at insert
-- so future pricing changes don't invalidate historical rows.
--
-- Seeds 4 budget.* settings keys (flat KV, not the app-settings JSON blob)
-- so each cap can be read/written independently by costs:get/set-budgets IPC.
--
-- defer_foreign_keys (lesson learned from 0010 fix 79e618a): even though we
-- DROP costs_log (no children) this migration ships in the same release as
-- future ones; staying explicit costs nothing.

PRAGMA defer_foreign_keys = 1;

DROP INDEX IF EXISTS idx_costs_company_date;
DROP TABLE IF EXISTS costs_log;

CREATE TABLE cost_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  adapter_name TEXT NOT NULL,
  model TEXT,
  session_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents_estimate INTEGER NOT NULL DEFAULT 0,
  occurred_at INTEGER NOT NULL
);

CREATE INDEX idx_cost_events_company_day ON cost_events(company_id, occurred_at);
CREATE INDEX idx_cost_events_agent_day   ON cost_events(agent_id, occurred_at);
CREATE INDEX idx_cost_events_project     ON cost_events(project_id);
CREATE INDEX idx_cost_events_adapter     ON cost_events(adapter_name, occurred_at);
CREATE INDEX idx_cost_events_issue       ON cost_events(issue_id);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('budget.max_tokens_per_day_per_agent', '2000000'),
  ('budget.max_tokens_per_issue',         '200000'),
  ('budget.rate_limit_window_tokens',     '1000000'),
  ('budget.rate_limit_window_hours',      '5');
