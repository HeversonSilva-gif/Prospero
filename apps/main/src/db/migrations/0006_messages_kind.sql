-- 0006_messages_kind.sql — M7.5 PR-B message kind tagging
-- Adds:
--   * messages.kind — one of message|proposal|question|confirmation|observation.
--     Default 'message' preserves existing rows. Validated in application code
--     (Zod) rather than at the SQL level so older rows imported from backups
--     never block a migration.

ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'message';
CREATE INDEX IF NOT EXISTS idx_messages_kind ON messages(kind);
