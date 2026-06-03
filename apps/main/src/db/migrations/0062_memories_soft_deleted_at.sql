-- 0062_memories_soft_deleted_at.sql — Record WHEN a memory was soft-deleted so
-- the maintenance pass can hard-purge it after a 30-day grace period (mirroring
-- the same mechanism skills already use via migration 0023).
-- NULL for live rows and for rows soft-deleted before this migration.

ALTER TABLE memories ADD COLUMN soft_deleted_at INTEGER;
