-- M14 PR-A Task 1: trust ladder backend.
-- Adds agents.trust_tier (no CHECK — M13 §5.1 convention: new enum value is a
-- TS-only change) + a trust_events audit table. defer_foreign_keys is not
-- needed here (additive only — ADD COLUMN + CREATE TABLE).

ALTER TABLE agents ADD COLUMN trust_tier TEXT NOT NULL DEFAULT 'novato';

CREATE TABLE trust_events (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL
                CHECK (kind IN ('promoted','demoted','promotion_suggested')),
  from_tier   TEXT NOT NULL,
  to_tier     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_trust_events_agent ON trust_events(agent_id);
