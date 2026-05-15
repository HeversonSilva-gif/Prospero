import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runPostMigration0004 } from "../db/post-migrations/0004.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { hireFromAgentsMd } from "./hire.js";
import type { AgentsMdPayload } from "./schema.js";

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

const PAYLOAD: AgentsMdPayload = {
  company: "Acme",
  projects: [{ name: "backend", path: "D:/code/backend" }],
  agents: [
    { name: "Alice", role: "engineer" },
    { name: "Bob", role: "qa", reports_to: "Alice" },
  ],
};

describe("hireFromAgentsMd", () => {
  it("creates projects + agents and wires reports_to", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });

    const summary = hireFromAgentsMd(db, PAYLOAD, {
      companyId: co.id,
      conflictModes: {},
    });

    expect(summary.companyId).toBe(co.id);
    expect(summary.created.projects).toBe(1);
    expect(summary.created.agents).toBe(2);
    expect(summary.warnings).toEqual([]);

    const projects = createProjectsRepository(db).listByCompany(co.id);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("backend");

    const agents = createAgentsRepository(db).listByCompany(co.id);
    expect(agents).toHaveLength(2);
    const bob = agents.find((a) => a.name === "Bob");
    const alice = agents.find((a) => a.name === "Alice");
    expect(bob?.reportsTo).toBe(alice?.id);
  });
});
