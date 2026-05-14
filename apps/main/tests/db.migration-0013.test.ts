import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

describe("migration 0013 — inbox goal_* kinds", () => {
  it("allows inserting goal_proposed, goal_executing, goal_error kinds", () => {
    const db = new Database(":memory:");
    applyMigrations(db);

    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "co_test",
      "Acme",
      Date.now(),
    );

    const insert = db.prepare(
      "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    expect(() =>
      insert.run("ib_1", "co_test", "goal_proposed", "Plan ready", 0, Date.now()),
    ).not.toThrow();
    expect(() =>
      insert.run("ib_2", "co_test", "goal_executing", "Executing", 0, Date.now()),
    ).not.toThrow();
    expect(() =>
      insert.run("ib_3", "co_test", "goal_error", "Failed", 0, Date.now()),
    ).not.toThrow();
  });

  it("preserves existing legacy kinds (approval, completed, etc.)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);

    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "co_test",
      "Acme",
      Date.now(),
    );
    const insert = db.prepare(
      "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    expect(() =>
      insert.run("ib_a", "co_test", "approval", "Tool request", 1, Date.now()),
    ).not.toThrow();
    expect(() => insert.run("ib_b", "co_test", "completed", "Done", 0, Date.now())).not.toThrow();
  });

  it("rejects unknown kinds via CHECK constraint", () => {
    const db = new Database(":memory:");
    applyMigrations(db);

    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "co_test",
      "Acme",
      Date.now(),
    );
    const insert = db.prepare(
      "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    expect(() => insert.run("ib_bad", "co_test", "bogus_kind", "x", 0, Date.now())).toThrow();
  });
});
