-- M9 PR-F.1: Projects polish — emoji icon + archived state.
-- Both columns nullable: existing projects load with icon=NULL, archived_at=NULL.

ALTER TABLE projects ADD COLUMN icon TEXT;
ALTER TABLE projects ADD COLUMN archived_at INTEGER;
