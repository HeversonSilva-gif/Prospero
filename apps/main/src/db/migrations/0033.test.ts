import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0033 — trust_promotion_suggested inbox kind", () => {
  const setup = () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      "c1",
      "Acme",
      Date.now(),
    );
    return db;
  };

  it("accepts the new kind", () => {
    const db = setup();
    db.prepare(
      "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?,?,?,?,?,?)",
    ).run("i1", "c1", "trust_promotion_suggested", "Promote?", 1, Date.now());
    const row = db.prepare("SELECT kind FROM inbox_items WHERE id = ?").get("i1") as {
      kind: string;
    };
    expect(row.kind).toBe("trust_promotion_suggested");
  });

  it("still rejects an unknown kind", () => {
    const db = setup();
    expect(() =>
      db
        .prepare(
          "INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at) VALUES (?,?,?,?,?,?)",
        )
        .run("i2", "c1", "definitely_not_a_kind", "x", 0, Date.now()),
    ).toThrow(/CHECK constraint failed/);
  });

  it("preserves idx_inbox_company_unread", () => {
    const db = setup();
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
      .get("idx_inbox_company_unread");
    expect(idx).toBeDefined();
  });
});
