import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";
import { runPostMigration0004 } from "./0004.js";
import { runPostMigration0007 } from "./0007.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  runPostMigration0004(db); // seeds the 5 canonical role rows
  return db;
};

describe("runPostMigration0007", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = newDb();
  });

  it("adds the is_seed_example / created_at / updated_at columns", () => {
    const cols = (db.pragma("table_info(role_templates)") as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("is_seed_example");
    expect(cols).toContain("created_at");
    expect(cols).toContain("updated_at");
  });

  it("flags the 5 seeded roles as seed examples", () => {
    runPostMigration0007(db);
    const seeds = db
      .prepare("SELECT id FROM role_templates WHERE is_seed_example = 1 ORDER BY id")
      .all() as Array<{ id: string }>;
    expect(seeds.map((r) => r.id)).toEqual([
      "role-ceo",
      "role-designer",
      "role-engineer",
      "role-pm",
      "role-qa",
    ]);
  });

  it("backfills created_at and updated_at to a real timestamp", () => {
    runPostMigration0007(db);
    const row = db
      .prepare("SELECT created_at, updated_at FROM role_templates WHERE id = 'role-ceo'")
      .get() as { created_at: number; updated_at: number };
    expect(row.created_at).toBeGreaterThan(0);
    expect(row.updated_at).toBeGreaterThan(0);
  });

  it("is idempotent — a second run does not throw", () => {
    runPostMigration0007(db);
    expect(() => runPostMigration0007(db)).not.toThrow();
  });
});
