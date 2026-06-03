import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createStripeSubscriptionsRepository } from "./stripe-subscriptions-repository.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
});

const sub = (
  over: Partial<
    Parameters<ReturnType<typeof createStripeSubscriptionsRepository>["record"]>[0]
  > = {},
) => ({
  id: "sub_1",
  companyId: "c1",
  customerId: "cus_1",
  status: "active",
  productId: "prod_1",
  productName: "Plano",
  amount: 1000,
  currency: "brl",
  interval: "month",
  createdAt: 1000,
  canceledAt: null,
  recordedAt: 0,
  ...over,
});

describe("stripe-subscriptions-repository", () => {
  it("records and lists by company", () => {
    const repo = createStripeSubscriptionsRepository(db);
    repo.record(sub());
    const list = repo.listByCompany("c1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "sub_1", status: "active", canceledAt: null });
  });

  it("upserts: re-recording the same id updates status + cancellation, no duplicate", () => {
    const repo = createStripeSubscriptionsRepository(db);
    repo.record(sub());
    repo.record(sub({ status: "canceled", canceledAt: 9000, recordedAt: 5 }));
    const list = repo.listByCompany("c1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "canceled", canceledAt: 9000 });
  });
});
