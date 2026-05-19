import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompaniesRepository } from "./repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

describe("companies repository", () => {
  it("create + list returns the inserted company", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const created = repo.create({ name: "Acme" });
    expect(created.name).toBe("Acme");
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0]!.id).toBe(created.id);
  });

  it("delete removes the company row", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const co = repo.create({ name: "ToDelete" });
    repo.delete(co.id);
    expect(repo.getById(co.id)).toBeNull();
    expect(repo.list()).toHaveLength(0);
  });

  it("delete cascades to agents", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const co = repo.create({ name: "WithAgent" });
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at)
       VALUES ('ag_1', ?, 'CEO', 'orch', 'p', 0, 0)`,
    ).run(co.id);
    expect(db.prepare("SELECT COUNT(*) as n FROM agents WHERE company_id = ?").get(co.id)).toEqual({
      n: 1,
    });
    repo.delete(co.id);
    expect(db.prepare("SELECT COUNT(*) as n FROM agents WHERE company_id = ?").get(co.id)).toEqual({
      n: 0,
    });
  });

  it("delete on nonexistent id is a no-op (no throw)", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    expect(() => repo.delete("co_doesnotexist")).not.toThrow();
  });

  it("getById returns telosPath (null by default)", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const company = repo.create({ name: "Acme" });
    expect(company.telosPath).toBeNull();
  });

  it("setTelosPath persists the relative telos path", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const company = repo.create({ name: "Acme" });
    repo.setTelosPath(company.id, "companies/c/telos.md");
    expect(repo.getById(company.id)?.telosPath).toBe("companies/c/telos.md");
  });
});
