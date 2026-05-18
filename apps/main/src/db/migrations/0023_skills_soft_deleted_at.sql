-- M11 PR-F2: record WHEN a skill was soft-deleted, so the boot maintenance
-- pass can hard-purge it after a 30-day grace period (terminate-promote
-- cascade). NULL for live rows and for rows soft-deleted before this migration.

ALTER TABLE skills ADD COLUMN soft_deleted_at INTEGER;
