import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0068 — stripe_subscriptions", () => {
  it("creates the stripe_subscriptions table with the expected columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(stripe_subscriptions)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    for (const c of [
      "id",
      "company_id",
      "customer_id",
      "status",
      "product_id",
      "product_name",
      "amount",
      "currency",
      "interval",
      "created_at",
      "canceled_at",
      "recorded_at",
    ]) {
      expect(cols).toContain(c);
    }
  });

  it("stores an active subscription row", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO stripe_subscriptions
         (id, company_id, customer_id, status, product_id, product_name, amount, currency, interval, created_at, canceled_at, recorded_at)
       VALUES ('sub_1','c1','cus_1','active','prod_1','Plano',1000,'brl','month',1,NULL,1)`,
    ).run();
    const row = db.prepare("SELECT status, canceled_at FROM stripe_subscriptions").get() as {
      status: string;
      canceled_at: number | null;
    };
    expect(row.status).toBe("active");
    expect(row.canceled_at).toBeNull();
  });
});
