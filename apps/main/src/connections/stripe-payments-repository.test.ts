import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createStripePaymentsRepository } from "./stripe-payments-repository.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
});

describe("stripe-payments-repository", () => {
  it("record is idempotent and reports new vs seen", () => {
    const repo = createStripePaymentsRepository(db);
    const charge = {
      id: "ch_1",
      companyId: "c1",
      amount: 900,
      currency: "brl",
      createdAt: 1000,
      recordedAt: 2000,
    };
    expect(repo.record(charge)).toBe(true);
    expect(repo.record(charge)).toBe(false);
    expect(repo.countByCompany("c1")).toBe(1);
  });

  it("listByCompany filters by sinceMs, newest first", () => {
    const repo = createStripePaymentsRepository(db);
    repo.record({
      id: "a",
      companyId: "c1",
      amount: 100,
      currency: "brl",
      createdAt: 1000,
      recordedAt: 0,
    });
    repo.record({
      id: "b",
      companyId: "c1",
      amount: 200,
      currency: "brl",
      createdAt: 3000,
      recordedAt: 0,
    });
    const recent = repo.listByCompany("c1", 2000);
    expect(recent.map((p) => p.id)).toEqual(["b"]);
  });

  it("totalsByCompany sums per currency", () => {
    const repo = createStripePaymentsRepository(db);
    repo.record({
      id: "a",
      companyId: "c1",
      amount: 900,
      currency: "brl",
      createdAt: 1,
      recordedAt: 0,
    });
    repo.record({
      id: "b",
      companyId: "c1",
      amount: 100,
      currency: "brl",
      createdAt: 2,
      recordedAt: 0,
    });
    repo.record({
      id: "c",
      companyId: "c1",
      amount: 500,
      currency: "usd",
      createdAt: 3,
      recordedAt: 0,
    });
    const totals = repo.totalsByCompany("c1");
    expect(totals.count).toBe(3);
    expect(totals.amountByCurrency).toEqual({ brl: 1000, usd: 500 });
  });

  it("totalsByCompany reports NET revenue (subtracts refunds) — I5", () => {
    const repo = createStripePaymentsRepository(db);
    repo.record({
      id: "a",
      companyId: "c1",
      amount: 1000,
      amountRefunded: 400,
      currency: "brl",
      createdAt: 1,
      recordedAt: 0,
    });
    const totals = repo.totalsByCompany("c1");
    expect(totals.amountByCurrency).toEqual({ brl: 600 }); // 1000 - 400 refunded
  });

  it("re-recording a charge updates its refund + customer but stays not-new — I5", () => {
    const repo = createStripePaymentsRepository(db);
    expect(
      repo.record({
        id: "a",
        companyId: "c1",
        amount: 1000,
        currency: "brl",
        createdAt: 1,
        recordedAt: 0,
        customerId: "cus_1",
      }),
    ).toBe(true);
    // later poll sees the same charge now refunded
    expect(
      repo.record({
        id: "a",
        companyId: "c1",
        amount: 1000,
        amountRefunded: 1000,
        currency: "brl",
        createdAt: 1,
        recordedAt: 5,
        customerId: "cus_1",
      }),
    ).toBe(false);
    expect(repo.totalsByCompany("c1").amountByCurrency).toEqual({ brl: 0 });
    expect(repo.countByCompany("c1")).toBe(1);
  });

  it("windowTotals counts + nets only charges in the window — C3", () => {
    const repo = createStripePaymentsRepository(db);
    repo.record({
      id: "old",
      companyId: "c1",
      amount: 500,
      currency: "brl",
      createdAt: 1000,
      recordedAt: 0,
    });
    repo.record({
      id: "new1",
      companyId: "c1",
      amount: 900,
      amountRefunded: 100,
      currency: "brl",
      createdAt: 5000,
      recordedAt: 0,
    });
    repo.record({
      id: "new2",
      companyId: "c1",
      amount: 200,
      currency: "brl",
      createdAt: 6000,
      recordedAt: 0,
    });
    const w = repo.windowTotals("c1", 4000);
    expect(w.count).toBe(2); // only new1 + new2
    expect(w.amountByCurrency).toEqual({ brl: 1000 }); // (900-100) + 200
  });

  it("lastCreatedAt returns the newest charge time or null — M3 backfill cursor", () => {
    const repo = createStripePaymentsRepository(db);
    expect(repo.lastCreatedAt("c1")).toBeNull();
    repo.record({
      id: "a",
      companyId: "c1",
      amount: 1,
      currency: "brl",
      createdAt: 1000,
      recordedAt: 0,
    });
    repo.record({
      id: "b",
      companyId: "c1",
      amount: 1,
      currency: "brl",
      createdAt: 9000,
      recordedAt: 0,
    });
    expect(repo.lastCreatedAt("c1")).toBe(9000);
  });
});
