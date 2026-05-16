import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createMemoriesRepository } from "../src/memory/memories-repository.js";

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

describe("memories-repository listCompanyGlobal", () => {
  it("returns only role-unscoped company-wide memories", () => {
    const db = seed();
    const repo = createMemoriesRepository(db);
    repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "global rule" });
    repo.create({
      companyId: "c1",
      agentId: null,
      kind: "rule",
      body: "engineer rule",
      appliesToRole: "engineer",
    });
    expect(repo.listCompanyGlobal("c1").map((m) => m.body)).toEqual(["global rule"]);
  });
});
