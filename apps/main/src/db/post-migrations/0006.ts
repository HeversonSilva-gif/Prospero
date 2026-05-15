import type Database from "better-sqlite3";

// Backfills messages_fts from messages that existed before M11. New messages
// are indexed live by the messages repository. Idempotent via a settings flag.

const FLAG_KEY = "post_migration_0006_done";

export const runPostMigration0006 = (db: Database.Database): void => {
  const done = db.prepare("SELECT value FROM settings WHERE key = ?").get(FLAG_KEY) as
    | { value: string }
    | undefined;
  if (done !== undefined) return;

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO messages_fts (message_id, content) SELECT id, content FROM messages",
    ).run();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(FLAG_KEY, "1");
  });
  tx();
};
