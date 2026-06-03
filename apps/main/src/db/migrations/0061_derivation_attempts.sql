-- 0061_derivation_attempts.sql — Make the derivation daily cap count ATTEMPTS,
-- not just successful runs. Previously the cap queried cost_events (which are
-- only written on success), so a burst of failing derivations (e.g. during an
-- auth outage) could spawn unbounded subprocesses. This table records one row
-- per (agent_id, UTC calendar day) and the worker increments `count` before
-- each run, regardless of outcome, so failures consume budget too.
--
-- `day_utc` is the UTC-midnight timestamp (ms) for the day, matching the same
-- boundary already used by the cost_events cap query.
CREATE TABLE derivation_attempts (
  agent_id TEXT    NOT NULL,
  day_utc  INTEGER NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, day_utc)
);
