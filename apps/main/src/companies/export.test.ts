import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exportCompany } from "./export.js";
import { createCompaniesRepository } from "./repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { companyTelosPath } from "./telos-dir.js";
import { goalIsaPath } from "../goals/isa-dir.js";

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

  it("includes telos and isa bodies when files exist on disk", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "WithArtifacts" });
    const goal = createGoalsRepository(db).create({ companyId: co.id, title: "G1" });

    const userDataDir = mkdtempSync(join(tmpdir(), "export-art-"));
    try {
      const telosFile = companyTelosPath(userDataDir, co.id);
      mkdirSync(dirname(telosFile), { recursive: true });
      writeFileSync(telosFile, "# TELOS\n\n## Mission\n\nx", "utf8");

      const isaFile = goalIsaPath(userDataDir, co.id, goal.id);
      mkdirSync(dirname(isaFile), { recursive: true });
      writeFileSync(isaFile, "# ISA\n\n## Vision\n\ny", "utf8");

      const out = exportCompany(db, co.id, userDataDir);
      expect(out.artifacts?.companyTelos).toContain("Mission");
      expect(out.artifacts?.goalIsas?.[goal.id]).toContain("Vision");
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it("omits artifacts when no files exist on disk", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "NoArtifacts" });
    const userDataDir = mkdtempSync(join(tmpdir(), "export-noart-"));
    try {
      const out = exportCompany(db, co.id, userDataDir);
      expect(out.artifacts).toBeUndefined();
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it("omits artifacts when userDataDir is not provided (back-compat)", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Legacy" });
    const out = exportCompany(db, co.id);
    expect(out.artifacts).toBeUndefined();
  });

  it("treats empty files on disk as absent artifacts (round-trips with import)", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "EmptyFiles" });
    const goal = createGoalsRepository(db).create({ companyId: co.id, title: "G1" });
    const userDataDir = mkdtempSync(join(tmpdir(), "export-empty-"));
    try {
      const telosFile = companyTelosPath(userDataDir, co.id);
      mkdirSync(dirname(telosFile), { recursive: true });
      writeFileSync(telosFile, "", "utf8");

      const isaFile = goalIsaPath(userDataDir, co.id, goal.id);
      mkdirSync(dirname(isaFile), { recursive: true });
      writeFileSync(isaFile, "", "utf8");

      const out = exportCompany(db, co.id, userDataDir);
      expect(out.artifacts).toBeUndefined();
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
