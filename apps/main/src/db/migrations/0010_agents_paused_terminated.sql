-- M7.6 PR-A: extend agents with pause + soft-delete lifecycle metadata.
-- AgentStatus union (string column) will accept new values 'paused' and 'terminated'
-- at the app layer; SQLite has no CHECK constraint to update.

ALTER TABLE agents ADD COLUMN paused_at INTEGER NULL;
ALTER TABLE agents ADD COLUMN terminated_at INTEGER NULL;
ALTER TABLE agents ADD COLUMN pause_reason TEXT NULL;

CREATE INDEX idx_agents_terminated ON agents(company_id, terminated_at);
