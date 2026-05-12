-- M7.6 PR-A: extend agents with pause + soft-delete lifecycle metadata.
-- The AgentStatus union gains 'paused' + 'terminated'. The 0001 CHECK
-- constraint hardcodes the old 5 values, and SQLite can't relax CHECKs
-- in place. Standard fix: recreate the table with the widened CHECK,
-- copy rows, swap names. FK cascades stay off during the swap.

PRAGMA foreign_keys = OFF;

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

-- Re-create indexes referenced by M7.5 PR-A (template_id) and M7.6 (terminated).
CREATE INDEX IF NOT EXISTS idx_agents_template ON agents(template_id);
CREATE INDEX idx_agents_terminated ON agents(company_id, terminated_at);

PRAGMA foreign_keys = ON;
