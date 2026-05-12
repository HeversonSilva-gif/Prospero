-- M8.5 PR-A: Goals + CEO Planning schema.
--
-- Two new tables (goals + goal_plans) + ALTER on issues to link goal_id.
-- goal_plans is versioned (one row per CEO submission) and references
-- proposed_by_agent_id for audit. JSON columns hold agents_to_hire,
-- issues_to_create, and risks arrays (Zod-validated at write time in
-- apps/main/src/mcp/tools-goals.ts).
--
-- defer_foreign_keys following the M8 PR-A convention (lesson 79e618a).

PRAGMA defer_foreign_keys = 1;

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  level TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'draft',
  parent_goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  owner_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  budget_max_tokens INTEGER,
  deadline INTEGER,
  success_criteria TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_goals_company ON goals(company_id);
CREATE INDEX idx_goals_parent  ON goals(parent_goal_id);
CREATE INDEX idx_goals_status  ON goals(status);

CREATE TABLE goal_plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  proposed_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  agents_to_hire_json TEXT NOT NULL,
  issues_to_create_json TEXT NOT NULL,
  estimated_total_tokens INTEGER,
  estimated_duration_days INTEGER,
  estimated_cost_cents INTEGER,
  risks_json TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  user_feedback TEXT,
  proposed_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT
);

CREATE INDEX idx_goal_plans_goal ON goal_plans(goal_id);
CREATE UNIQUE INDEX idx_goal_plans_goal_version ON goal_plans(goal_id, version);

ALTER TABLE issues ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;
CREATE INDEX idx_issues_goal ON issues(goal_id);
