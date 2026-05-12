-- 0009_activity_events.sql — M7.7 Activity Stream foundation
-- Append-only audit stream for cross-cutting "what happened in the company"
-- view. Dual-write companion to issue_events / inbox_items (those keep
-- working untouched). No FK on entity_id by design — preserves audit when
-- the entity is later deleted.

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  agent_id TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_company_time ON activity_events(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity       ON activity_events(entity_kind, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_agent_time   ON activity_events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_action       ON activity_events(action);
