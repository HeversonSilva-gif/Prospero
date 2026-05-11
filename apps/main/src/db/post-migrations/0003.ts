import type Database from "better-sqlite3";

// Clears stale claude_session_id values from agents.
//
// Context: in this release we changed each agent's spawn CWD from the Electron main
// process's cwd (apps/main/) to a per-agent sandbox dir under userData. Claude CLI
// indexes its session storage by encoded CWD path, so any session_id captured under
// the old CWD becomes unreachable — `--resume <stale-id>` fails with "No conversation
// found with session ID" and the spawned process exits 1.
//
// onExit handler already clears the session lazily, but it lets the first user message
// after upgrade get lost. This migration clears all session IDs preemptively so the
// next spawn starts cleanly.
//
// Idempotent via a settings flag — runs exactly once per machine.
const FLAG_KEY = "post_migration_0003_done";

export const runPostMigration0003 = (db: Database.Database): void => {
  const done = db.prepare("SELECT value FROM settings WHERE key = ?").get(FLAG_KEY) as
    | { value: string }
    | undefined;
  if (done !== undefined) return;

  const tx = db.transaction(() => {
    db.prepare("UPDATE agents SET claude_session_id = NULL").run();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(FLAG_KEY, "1");
  });
  tx();
};
