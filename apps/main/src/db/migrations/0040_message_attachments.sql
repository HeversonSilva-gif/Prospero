-- 0040_message_attachments.sql — v0.1.18 chat-slack-like
-- Adds the message_attachments table so users can attach files to chat
-- messages. message_id is nullable to support pending uploads (the row is
-- created before the chat message is committed) and gets backfilled inside
-- the same transaction as the message INSERT. ON DELETE CASCADE drops the
-- attachment rows when the parent message is removed.

CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  local_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON message_attachments(message_id);
