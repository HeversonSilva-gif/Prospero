import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0067 — stripe_payments refunds + customer", () => {
  it("adds amount_refunded (default 0) and customer_id columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(stripe_payments)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain("amount_refunded");
    expect(cols).toContain("customer_id");
  });

  it("amount_refunded defaults to 0 and customer_id to NULL", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO stripe_payments (id, company_id, amount, currency, created_at, recorded_at)
       VALUES ('ch_1','c1',1000,'brl',1,1)`,
    ).run();
    const row = db
      .prepare("SELECT amount_refunded, customer_id FROM stripe_payments WHERE id = 'ch_1'")
      .get() as { amount_refunded: number; customer_id: string | null };
    expect(row.amount_refunded).toBe(0);
    expect(row.customer_id).toBeNull();
  });
});
