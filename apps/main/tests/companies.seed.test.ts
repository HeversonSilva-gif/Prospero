import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createDemoCompany } from "../src/companies/seed.js";
import { createAgentsRepository } from "../src/agents/repository.js";

describe("createDemoCompany", () => {
  it("creates a company with a CEO agent", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const company = createDemoCompany(db);
    const agents = createAgentsRepository(db).listByCompany(company.id);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.name).toBe("CEO");
    expect(agents[0]?.role).toBe("Chief Executive Officer");
  });
});
