-- M13 PR-A: Ideal State Artifact — goal_criteria (the ISCs) + goals.isa_path.
--
-- goal_criteria holds the verifiable criteria of a goal's ISA. `kind` splits
-- machine-checkable ('deterministic') from human/agent-judged ('judgment').
-- check_type/check_spec are set only for deterministic criteria; check_spec is
-- JSON validated by apps/main/src/schemas/criterionCheckSpec.ts at write time.
-- status/last_checked_at/last_result_json/verified_by are written by the
-- verification engine (M13 PR-B) — in PR-A they keep their defaults.
--
-- isa_path marks a goal whose isa.md has been materialized. The file itself
-- lives on disk under <userData>/companies/<cid>/goals/<gid>/isa.md and is the
-- source of truth (mirrors the M12 instruction-bundle pattern).
--
-- defer_foreign_keys following the M8 PR-A convention.

PRAGMA defer_foreign_keys = 1;

CREATE TABLE goal_criteria (
  id                TEXT PRIMARY KEY,
  goal_id           TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  sort_order        INTEGER NOT NULL,
  statement         TEXT NOT NULL,
  kind              TEXT NOT NULL
                      CHECK (kind IN ('deterministic','judgment')),
  check_type        TEXT
                      CHECK (check_type IN ('command','metric','artifact_exists')),
  check_spec        TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','passed','failed','waived')),
  last_checked_at   INTEGER,
  last_result_json  TEXT,
  verified_by       TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_goal_criteria_goal ON goal_criteria(goal_id);

ALTER TABLE goals ADD COLUMN isa_path TEXT;
