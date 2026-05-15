import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runPostMigration0004 } from "../db/post-migrations/0004.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { buildExportPayload } from "./build-export.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  runPostMigration0004(db);
  return db;
};

describe("buildExportPayload", () => {
  it("collects active company projects + agents with reports_to as name", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const projects = createProjectsRepository(db);
    projects.create({ companyId: co.id, name: "backend", path: "D:/code/backend", color: "#1" });

    const agents = createAgentsRepository(db);
    const alice = agents.create({
      companyId: co.id,
      name: "Alice",
      role: "role-engineer",
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
      templateId: "role-engineer",
      actor: { kind: "user" },
    });
    const bob = agents.create({
      companyId: co.id,
      name: "Bob",
      role: "role-qa",
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
      templateId: "role-qa",
      actor: { kind: "user" },
    });
    agents.setReportsTo(bob.id, alice.id);

    const payload = buildExportPayload(db, co.id);
    expect(payload.company).toBe("Acme");
    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0]?.path).toBe("D:/code/backend");
    expect(payload.agents).toHaveLength(2);
    const bobOut = payload.agents.find((a) => a.name === "Bob");
    expect(bobOut?.reports_to).toBe("Alice");
  });

  it("skips terminated agents", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agents = createAgentsRepository(db);
    const gone = agents.create({
      companyId: co.id,
      name: "Gone",
      role: "role-engineer",
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
      templateId: "role-engineer",
      actor: { kind: "user" },
    });
    agents.terminate(gone.id, "test");

    const payload = buildExportPayload(db, co.id);
    expect(payload.agents).toEqual([]);
  });
});
