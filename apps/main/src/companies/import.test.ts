import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportCompany } from "./export.js";
import { importCompany } from "./import.js";
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

describe("importCompany", () => {
  it("rejects payload with wrong schemaVersion", () => {
    const db = setupDb();
    expect(() =>
      importCompany(db, {
        schemaVersion: 2,
        exportedAt: 1,
        company: { id: "x", name: "n", createdAt: 1 },
        agents: [],
        projects: [],
        issues: [],
        threads: [],
        messages: [],
        inbox: [],
        costEvents: [],
        activityEvents: [],
        goals: [],
        approvals: [],
      }),
    ).toThrow(/invalid payload/);
  });

  it("imports an empty company and assigns a fresh id", () => {
    const db = setupDb();
    const source = createCompaniesRepository(db).create({ name: "Acme" });
    const snapshot = exportCompany(db, source.id);

    const result = importCompany(db, snapshot);

    expect(result.newCompanyId).not.toBe(source.id);
    expect(result.newCompanyName).toBe("Acme (imported)");
    expect(result.counts.agents).toBe(0);
    expect(result.counts.projects).toBe(0);
    expect(result.warnings).toEqual([]);
    const row = db.prepare("SELECT name FROM companies WHERE id = ?").get(result.newCompanyId) as
      | { name: string }
      | undefined;
    expect(row?.name).toBe("Acme (imported)");
  });

  it("preserves original name when no collision exists", () => {
    const db = setupDb();
    const source = createCompaniesRepository(db).create({ name: "OnlyOne" });
    const snapshot = exportCompany(db, source.id);
    db.prepare("DELETE FROM companies WHERE id = ?").run(source.id);

    const result = importCompany(db, snapshot);
    expect(result.newCompanyName).toBe("OnlyOne");
  });

  it("roundtrips projects and remaps company_id", () => {
    const db = setupDb();
    const source = createCompaniesRepository(db).create({ name: "Roundtrip" });
    const projectsRepo = createProjectsRepository(db);
    projectsRepo.create({ companyId: source.id, name: "Web", path: "/w", color: "#111" });
    projectsRepo.create({ companyId: source.id, name: "Api", path: "/a", color: "#222" });

    const snapshot = exportCompany(db, source.id);
    const result = importCompany(db, snapshot);

    expect(result.counts.projects).toBe(2);
    const imported = db
      .prepare("SELECT name FROM projects WHERE company_id = ? ORDER BY name")
      .all(result.newCompanyId) as { name: string }[];
    expect(imported.map((r) => r.name)).toEqual(["Api", "Web"]);
  });

  it("renumbers ids so old and new company coexist", () => {
    const db = setupDb();
    const source = createCompaniesRepository(db).create({ name: "Coexist" });
    createProjectsRepository(db).create({
      companyId: source.id,
      name: "Solo",
      path: "/s",
      color: "#fff",
    });

    const snapshot = exportCompany(db, source.id);
    const result = importCompany(db, snapshot);

    const sourceProjects = db
      .prepare("SELECT id FROM projects WHERE company_id = ?")
      .all(source.id) as { id: string }[];
    const importedProjects = db
      .prepare("SELECT id FROM projects WHERE company_id = ?")
      .all(result.newCompanyId) as { id: string }[];
    expect(sourceProjects).toHaveLength(1);
    expect(importedProjects).toHaveLength(1);
    expect(sourceProjects[0]!.id).not.toBe(importedProjects[0]!.id);
  });

  it("warns when a payload row has no id but does not abort import", () => {
    const db = setupDb();
    const source = createCompaniesRepository(db).create({ name: "Partial" });
    const snapshot = exportCompany(db, source.id);
    (snapshot.projects as Record<string, unknown>[]).push({ name: "Broken" });

    const result = importCompany(db, snapshot);
    expect(result.warnings.some((w) => w.includes("projects row without id"))).toBe(true);
    expect(result.counts.projects).toBe(0);
  });

  it("restores telos and isa bodies into the new company's userData", () => {
    const db = setupDb();
    const source = createCompaniesRepository(db).create({ name: "WithArt" });
    const goal = createGoalsRepository(db).create({ companyId: source.id, title: "G1" });

    const srcUserData = mkdtempSync(join(tmpdir(), "import-src-"));
    const destUserData = mkdtempSync(join(tmpdir(), "import-dst-"));
    try {
      const telosFile = companyTelosPath(srcUserData, source.id);
      mkdirSync(dirname(telosFile), { recursive: true });
      writeFileSync(telosFile, "# TELOS\n\n## Mission\n\nx", "utf8");

      const isaFile = goalIsaPath(srcUserData, source.id, goal.id);
      mkdirSync(dirname(isaFile), { recursive: true });
      writeFileSync(isaFile, "# ISA\n\n## Vision\n\ny", "utf8");

      const snapshot = exportCompany(db, source.id, srcUserData);
      expect(snapshot.artifacts?.companyTelos).toContain("Mission");

      const result = importCompany(db, snapshot, destUserData);

      const newGoalId = result.goalIdMap[goal.id];
      expect(newGoalId).toBeDefined();

      const restoredTelosPath = companyTelosPath(destUserData, result.newCompanyId);
      expect(existsSync(restoredTelosPath)).toBe(true);
      expect(readFileSync(restoredTelosPath, "utf8")).toContain("Mission");

      const restoredIsaPath = goalIsaPath(destUserData, result.newCompanyId, newGoalId!);
      expect(existsSync(restoredIsaPath)).toBe(true);
      expect(readFileSync(restoredIsaPath, "utf8")).toContain("Vision");

      // Path markers are stamped so the DB reflects restored artifacts.
      const companyRow = db
        .prepare("SELECT telos_path FROM companies WHERE id = ?")
        .get(result.newCompanyId) as { telos_path: string | null };
      expect(companyRow.telos_path).toMatch(/telos\.md$/);
      const goalRow = db.prepare("SELECT isa_path FROM goals WHERE id = ?").get(newGoalId) as {
        isa_path: string | null;
      };
      expect(goalRow.isa_path).toMatch(/isa\.md$/);
    } finally {
      rmSync(srcUserData, { recursive: true, force: true });
      rmSync(destUserData, { recursive: true, force: true });
    }
  });

  it("returns an empty goalIdMap when the source has no goals", () => {
    const db = setupDb();
    const source = createCompaniesRepository(db).create({ name: "NoGoals" });
    const snapshot = exportCompany(db, source.id);
    const result = importCompany(db, snapshot);
    expect(result.goalIdMap).toEqual({});
  });
});
