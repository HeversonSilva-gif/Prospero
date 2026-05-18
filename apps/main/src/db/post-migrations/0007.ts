import type Database from "better-sqlite3";

// Marks the 5 canonical roles (seeded by post-migration 0004) as seed examples
// and backfills created_at / updated_at on every pre-existing role_templates
// row. Idempotent via the post_migration_0007_done settings flag.

const FLAG_KEY = "post_migration_0007_done";

const SEED_ROLE_IDS = ["role-ceo", "role-engineer", "role-qa", "role-designer", "role-pm"];

export const runPostMigration0007 = (db: Database.Database): void => {
  const done = db.prepare("SELECT value FROM settings WHERE key = ?").get(FLAG_KEY) as
    | { value: string }
    | undefined;
  if (done !== undefined) return;

  const now = Date.now();

  const tx = db.transaction(() => {
    const markSeed = db.prepare("UPDATE role_templates SET is_seed_example = 1 WHERE id = ?");
    for (const id of SEED_ROLE_IDS) markSeed.run(id);

    db.prepare("UPDATE role_templates SET created_at = ?, updated_at = ? WHERE created_at = 0").run(
      now,
      now,
    );

    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(FLAG_KEY, "1");
  });
  tx();
};
