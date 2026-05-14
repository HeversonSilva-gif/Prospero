import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exportCompany } from "./export.js";
import { createCompaniesRepository } from "./repository.js";
import { createProjectsRepository } from "../projects/repository.js";

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

describe("exportCompany", () => {
  it("throws when company id is unknown", () => {
    const db = setupDb();
    expect(() => exportCompany(db, "co_doesnotexist")).toThrow(/not found/);
  });

  it("returns schemaVersion 1 + company metadata", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const out = exportCompany(db, co.id);
    expect(out.schemaVersion).toBe(1);
    expect(out.company.id).toBe(co.id);
    expect(out.company.name).toBe("Acme");
    expect(out.exportedAt).toBeGreaterThan(0);
  });

  it("includes child rows scoped to the company", () => {
    const db = setupDb();
    const co1 = createCompaniesRepository(db).create({ name: "C1" });
    const co2 = createCompaniesRepository(db).create({ name: "C2" });
    createProjectsRepository(db).create({
      companyId: co1.id,
      name: "P1",
      path: "/p1",
      color: "#fff",
    });
    createProjectsRepository(db).create({
      companyId: co2.id,
      name: "P2",
      path: "/p2",
      color: "#fff",
    });
    const out = exportCompany(db, co1.id);
    expect(out.projects).toHaveLength(1);
    expect((out.projects[0] as { name: string }).name).toBe("P1");
  });

  it("returns empty arrays for tables with no rows", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Empty" });
    const out = exportCompany(db, co.id);
    expect(out.agents).toEqual([]);
    expect(out.issues).toEqual([]);
    expect(out.messages).toEqual([]);
  });
});
