import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createProjectsRepository } from "../src/projects/repository.js";

const seedCompany = (db: Database.Database, id = "co_test"): string => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    id,
    "Test Co",
    Date.now(),
  );
  return id;
};

describe("ProjectsRepository — slug", () => {
  it("create() persists slug=null by default", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companyId = seedCompany(db);
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId, name: "Backend Service", path: "C:/x", color: "#000" });
    expect(p.slug).toBeNull();
  });

  it("setSlug() persists uppercase alphanumeric slug", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companyId = seedCompany(db);
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId, name: "Backend Service", path: "C:/x", color: "#000" });
    repo.setSlug(p.id, "BACKEND");
    const got = repo.getById(p.id);
    expect(got?.slug).toBe("BACKEND");
  });

  it("setSlug() rejects empty string", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companyId = seedCompany(db);
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId, name: "X", path: "C:/x", color: "#000" });
    expect(() => repo.setSlug(p.id, "")).toThrow(/non-empty/i);
  });
});
