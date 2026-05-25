import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectsRepository } from "./repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
  return db;
};

describe("setIcon", () => {
  it("persists an emoji icon", () => {
    const db = setupDb();
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId: "c1", name: "P1", path: "/p1", color: "#fff" });
    repo.setIcon(p.id, "🚀");
    expect(repo.getById(p.id)?.icon).toBe("🚀");
  });

  it("setIcon null clears the icon", () => {
    const db = setupDb();
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId: "c1", name: "P1", path: "/p1", color: "#fff" });
    repo.setIcon(p.id, "🚀");
    repo.setIcon(p.id, null);
    expect(repo.getById(p.id)?.icon).toBeNull();
  });
});

describe("setDigestPath", () => {
  it("persists a digest path marker", () => {
    const db = setupDb();
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId: "c1", name: "P1", path: "/p1", color: "#fff" });
    expect(repo.getById(p.id)?.digestPath).toBeNull();
    repo.setDigestPath(p.id, "companies/c1/projects/" + p.id + "/digest.json");
    expect(repo.getById(p.id)?.digestPath).toBe("companies/c1/projects/" + p.id + "/digest.json");
  });
});

describe("archive / unarchive", () => {
  it("archive sets archivedAt to a positive number", () => {
    const db = setupDb();
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId: "c1", name: "P1", path: "/p1", color: "#fff" });
    repo.archive(p.id);
    const after = repo.getById(p.id);
    expect(after?.archivedAt).not.toBeNull();
    expect(typeof after?.archivedAt).toBe("number");
  });

  it("unarchive clears archivedAt", () => {
    const db = setupDb();
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId: "c1", name: "P1", path: "/p1", color: "#fff" });
    repo.archive(p.id);
    repo.unarchive(p.id);
    expect(repo.getById(p.id)?.archivedAt).toBeNull();
  });
});
