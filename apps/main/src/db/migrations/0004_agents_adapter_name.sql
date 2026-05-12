-- 0004_agents_adapter_name.sql — M7.5 PR-A adapter pattern foundation
-- Adds:
--   * agents.adapter_name — selects which AgentAdapter implementation drives the agent.
--     Default 'claude-oauth-local' matches current behavior. M9 adds 'claude-api-key-local',
--     M10 adds 'claude-oauth-remote-docker'.

ALTER TABLE agents ADD COLUMN adapter_name TEXT NOT NULL DEFAULT 'claude-oauth-local';
