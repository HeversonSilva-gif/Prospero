import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createProjectsRepository } from "../src/projects/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const c = createCompaniesRepository(db).create({ name: "Acme" });
  const projects = createProjectsRepository(db);
  return { db, projects, companyId: c.id };
};

describe("projects repository", () => {
  it("create + listByCompany", () => {
    const { projects, companyId } = setup();
    const p = projects.create({ companyId, name: "Web", path: "C:/web", color: "#1D5DD7" });
    expect(p.name).toBe("Web");
    expect(projects.listByCompany(companyId)).toHaveLength(1);
  });

  it("getById returns project or null", () => {
    const { projects, companyId } = setup();
    const p = projects.create({ companyId, name: "X", path: "C:/x", color: "#10b981" });
    expect(projects.getById(p.id)?.name).toBe("X");
    expect(projects.getById("nope")).toBeNull();
  });

  it("update mutates only provided fields", () => {
    const { projects, companyId } = setup();
    const p = projects.create({ companyId, name: "Old", path: "C:/o", color: "#1D5DD7" });
    projects.update(p.id, { name: "New" });
    expect(projects.getById(p.id)?.name).toBe("New");
    expect(projects.getById(p.id)?.path).toBe("C:/o");
  });

  it("delete removes the row", () => {
    const { projects, companyId } = setup();
    const p = projects.create({ companyId, name: "Z", path: "C:/z", color: "#dc2626" });
    projects.delete(p.id);
    expect(projects.getById(p.id)).toBeNull();
  });

  it("checkPaths returns 'available' for existing dirs and 'missing' otherwise", () => {
    const { projects, companyId } = setup();
    const tmp = process.cwd();
    const p1 = projects.create({ companyId, name: "Real", path: tmp, color: "#1D5DD7" });
    const p2 = projects.create({
      companyId,
      name: "Ghost",
      path: "C:/this/path/does/not/exist/xyz123",
      color: "#1D5DD7",
    });
    const status = projects.checkPaths(companyId);
    expect(status[p1.id]).toBe("available");
    expect(status[p2.id]).toBe("missing");
  });
});
