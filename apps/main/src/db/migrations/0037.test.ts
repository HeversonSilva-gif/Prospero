import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

function insertCompany(db: Database.Database, id = "c1"): void {
  db.prepare("INSERT OR IGNORE INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    id,
    "Acme",
    Date.now(),
  );
}

describe("migration 0037 — CEO approval routing columns", () => {
  it("adds routed_to + escalated_at to approvals with NULL defaults", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    insertCompany(db);
    db.prepare(
      `INSERT INTO approvals (id, agent_id, kind, payload_json, status, created_at)
       VALUES ('apv1', NULL, 'tool_call', '{}', 'pending', ?)`,
    ).run(Date.now());

    const row = db
      .prepare("SELECT routed_to, escalated_at FROM approvals WHERE id = 'apv1'")
      .get() as { routed_to: string | null; escalated_at: number | null };

    expect(row.routed_to).toBeNull();
    expect(row.escalated_at).toBeNull();
  });

  it("accepts manager_request as an approvals.kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    insertCompany(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO approvals (id, agent_id, kind, payload_json, status, routed_to, created_at)
         VALUES ('apv2', NULL, 'manager_request', '{}', 'pending', 'ceo', ?)`,
        )
        .run(Date.now()),
    ).not.toThrow();
  });
});
