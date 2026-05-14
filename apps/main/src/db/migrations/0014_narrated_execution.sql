-- M8.6 PR-A: add narrated-execution state to goals + per-issue dependency
-- pointers for topological unlock.
--
-- Both columns are TEXT nullable so backward-compat for M8.5 rows is
-- automatic (default NULL = not in narrated execution / no deps tracked).
-- Partial index on issues.depends_on_json keeps lookups cheap.

PRAGMA defer_foreign_keys = 1;

ALTER TABLE goals ADD COLUMN execution_state_json TEXT;

ALTER TABLE issues ADD COLUMN depends_on_json TEXT;

CREATE INDEX idx_issues_depends_on
  ON issues(depends_on_json)
  WHERE depends_on_json IS NOT NULL;
