-- M7.6 PR-A: extend agents with pause + soft-delete lifecycle metadata.
-- The AgentStatus union gains 'paused' + 'terminated'. The 0001 CHECK
-- constraint hardcodes the old 5 values, and SQLite can't relax CHECKs
-- in place. Standard fix: recreate the table with the widened CHECK,
-- copy rows, swap names.
--
-- IMPORTANT: PRAGMA foreign_keys = OFF is a NO-OP inside a transaction
-- (SQLite semantics). applyMigrations() wraps every migration in a
-- transaction. Without disabling FKs, DROP TABLE agents fires the
-- ON DELETE SET NULL action on every child FK (issues.assignee_id,
-- inbox_items.actor_id, costs_log.agent_id, agents.reports_to self-ref)
-- BEFORE the rename happens — wiping all those columns to NULL.
-- defer_foreign_keys works inside transactions: it postpones the FK
-- check until commit. At commit the schema is back to a valid state
-- (agents_new renamed to agents with all original ids preserved), so
-- no violations fire.

PRAGMA defer_foreign_keys = 1;

CREATE TABLE agents_new (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  template_id TEXT,
  system_prompt TEXT NOT NULL,
  skills_json TEXT NOT NULL DEFAULT '[]',
  allowed_projects_json TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'supervised'
    CHECK (mode IN ('supervised','auto')),
  always_on INTEGER NOT NULL DEFAULT 0
    CHECK (always_on IN (0,1)),
  reports_to TEXT REFERENCES agents(id) ON DELETE SET NULL,
  claude_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle','thinking','working','waiting','error','paused','terminated')),
  current_action TEXT,
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  adapter_name TEXT NOT NULL DEFAULT 'claude-oauth-local',
  paused_at INTEGER NULL,
  terminated_at INTEGER NULL,
  pause_reason TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO agents_new (
  id, company_id, name, role, template_id, system_prompt,
  skills_json, allowed_projects_json, mode, always_on, reports_to,
  claude_session_id, status, current_action, model, adapter_name,
  paused_at, terminated_at, pause_reason, created_at, updated_at
)
SELECT
  id, company_id, name, role, template_id, system_prompt,
  skills_json, allowed_projects_json, mode, always_on, reports_to,
  claude_session_id, status, current_action, model, adapter_name,
  NULL, NULL, NULL, created_at, updated_at
FROM agents;

DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

-- Re-create indexes lost when we dropped the original agents table.
-- idx_agents_company from 0001, idx_agents_template from 0003, plus the
-- new idx_agents_terminated for M7.6 soft-delete queries.
CREATE INDEX IF NOT EXISTS idx_agents_company ON agents(company_id);
CREATE INDEX IF NOT EXISTS idx_agents_template ON agents(template_id);
CREATE INDEX idx_agents_terminated ON agents(company_id, terminated_at);
