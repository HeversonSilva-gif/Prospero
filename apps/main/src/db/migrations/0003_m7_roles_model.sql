-- 0003_m7_roles_model.sql — M7 model selection + roles scaffold
-- Adds:
--   * agents.model — Claude model id used at spawn (passed as --model)
--   * role_templates.default_model — default model when role applied to a new agent
--   * idx_agents_template — fast lookup for "agents using role X" in /skills page

ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';

ALTER TABLE role_templates ADD COLUMN default_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';

CREATE INDEX IF NOT EXISTS idx_agents_template ON agents(template_id);
