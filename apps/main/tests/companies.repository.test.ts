import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return createCompaniesRepository(db);
};

describe("companies repository", () => {
  it("create + list + getById", () => {
    const repo = setup();
    const c = repo.create({ name: "Kronos" });
    expect(c.id).toBeDefined();
    expect(c.name).toBe("Kronos");
    expect(repo.list()).toHaveLength(1);
    expect(repo.getById(c.id)?.name).toBe("Kronos");
  });

  it("list returns ordered by createdAt", () => {
    const repo = setup();
    const a = repo.create({ name: "A" });
    const b = repo.create({ name: "B" });
    const all = repo.list();
    expect(all[0]?.id).toBe(a.id);
    expect(all[1]?.id).toBe(b.id);
  });
});
