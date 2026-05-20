-- M13 PR-D: goal_criteria.attempts — counts how many times a criterion has
-- been checked (via applyResult). With attempts + status we can derive
-- "passed first try" (attempts=1, status=passed) vs "failed N times then
-- passed" (attempts>1, status=passed) vs "still failing" (attempts>0,
-- status=failed). This is the smallest signal the LEARN phase of the
-- Algorithm needs to enrich the M11 derivation pipeline per spec §8.5.
-- Existing rows backfill to 0 via the column default.

ALTER TABLE goal_criteria ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
