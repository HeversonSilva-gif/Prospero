import type Database from "better-sqlite3";

// Audit 2026-06-03 Inteligência & Contexto I4: the runtime moved the CEO from
// Opus 4.7 to 4.8, but role_templates rows seeded on an older install (and the
// 0004 seed itself, now fixed) still carried claude-opus-4-7. Bumps any
// role_template default_model off the retired 4.7 id onto 4.8 so a CEO hired
// from a template matches the live onboarding CEO. Idempotent via the
// post_migration_0008_done settings flag.

const FLAG_KEY = "post_migration_0008_done";

export const runPostMigration0008 = (db: Database.Database): void => {
  const done = db.prepare("SELECT value FROM settings WHERE key = ?").get(FLAG_KEY) as
    | { value: string }
    | undefined;
  if (done !== undefined) return;

  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE role_templates SET default_model = 'claude-opus-4-8' WHERE default_model = 'claude-opus-4-7'",
    ).run();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(FLAG_KEY, "1");
  });
  tx();
};
