-- 0062_derivation_attempts_trigger_class.sql — Segment the derivation daily cap
-- by trigger CLASS. Previously one shared per-(agent,day) budget covered every
-- trigger, so on a busy day success lessons (issue_done/recovery/goal_achieved)
-- and failure lessons (verification_failed/approval_rejected) starved each
-- other — whichever fired first ate the budget. Add `trigger_class` to the key
-- so each class has its own budget. Existing rows become 'success' (the old
-- count was dominated by the success-side triggers). Audit 2026-06-03 Facet 5 M2.
ALTER TABLE derivation_attempts RENAME TO derivation_attempts_old;

CREATE TABLE derivation_attempts (
  agent_id      TEXT    NOT NULL,
  day_utc       INTEGER NOT NULL,
  trigger_class TEXT    NOT NULL DEFAULT 'success',
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, day_utc, trigger_class)
);

INSERT INTO derivation_attempts (agent_id, day_utc, trigger_class, count)
  SELECT agent_id, day_utc, 'success', count FROM derivation_attempts_old;

DROP TABLE derivation_attempts_old;
