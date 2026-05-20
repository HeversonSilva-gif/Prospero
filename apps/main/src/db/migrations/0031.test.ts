import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0031 — inbox security_zone_blocked kind", () => {
  it("allows the security_zone_blocked kind on inbox_items", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    expect(() => {
      db.prepare(
        `INSERT INTO inbox_items (id, company_id, kind, actor_id, title, preview, payload_json, requires_action, approval_id, read_at, created_at)
         VALUES ('i1','c1','security_zone_blocked',NULL,'Zone block: cross-company',NULL,NULL,0,NULL,NULL,0)`,
      ).run();
    }).not.toThrow();
  });

  it("still rejects an unknown kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    expect(() => {
      db.prepare(
        `INSERT INTO inbox_items (id, company_id, kind, actor_id, title, preview, payload_json, requires_action, approval_id, read_at, created_at)
         VALUES ('i2','c1','definitely_not_a_kind',NULL,'x',NULL,NULL,0,NULL,NULL,0)`,
      ).run();
    }).toThrow(/CHECK constraint failed/);
  });

  it("preserves the idx_inbox_company_unread index after recreation", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_inbox_company_unread'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("idx_inbox_company_unread");
  });
});
