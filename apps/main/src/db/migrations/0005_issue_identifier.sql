-- 0005_issue_identifier.sql — M7.5 PR-B human identifier for issues
-- Adds:
--   * projects.slug — human-readable project prefix (e.g. 'BACKEND')
--   * issues.issue_number — monotonic counter per project (1..N)
--   * issues.identifier — derived '${slug}-${issue_number}' for display
-- Backfill of legacy rows is done by the post-migration TS script
-- runPostMigration0005 (see apps/main/src/db/post-migrations/0005.ts).
-- NOT NULL is enforced in application code (repo + Zod) to avoid the SQLite
-- ALTER TABLE NOT NULL limitation; the index pair below catches drift.

ALTER TABLE projects ADD COLUMN slug TEXT;
ALTER TABLE issues ADD COLUMN issue_number INTEGER;
ALTER TABLE issues ADD COLUMN identifier TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_project_number
  ON issues(project_id, issue_number);
CREATE INDEX IF NOT EXISTS idx_issues_identifier
  ON issues(identifier);
