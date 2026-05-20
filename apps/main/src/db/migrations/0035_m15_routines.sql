-- M15 PR-A Task 1: Routines — agents that wake on a schedule or on a fixed
-- activity event. trigger_type discriminates the two columns sets; schedule
-- routines have schedule_spec + next_fire_at; event routines have event_spec.
-- target_agent_id cascades on agent termination/delete — a routine without a
-- live target is unreachable.

CREATE TABLE routines (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('schedule','event')),
  schedule_spec   TEXT,
  next_fire_at    INTEGER,
  event_spec      TEXT,
  target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  instruction     TEXT NOT NULL,
  last_fired_at   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_routines_company   ON routines(company_id);
CREATE INDEX idx_routines_next_fire ON routines(next_fire_at);
