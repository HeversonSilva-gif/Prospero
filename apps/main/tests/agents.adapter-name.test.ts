import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

describe("agents.adapterName surfaced through repo (M7.5 PR-A)", () => {
  it("rowToAgent surfaces adapterName='claude-oauth-local' by default on freshly created agents", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companies = createCompaniesRepository(db);
    const agents = createAgentsRepository(db);
    const co = companies.create({ name: "Co" });
    const agent = agents.create({
      companyId: co.id,
      name: "Boss",
      role: "CEO",
      systemPrompt: "You are boss.",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(agent.adapterName).toBe("claude-oauth-local");
  });

  it("listByCompany returns agents with adapterName populated", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companies = createCompaniesRepository(db);
    const agents = createAgentsRepository(db);
    const co = companies.create({ name: "Co" });
    agents.create({
      companyId: co.id,
      name: "A",
      role: "CEO",
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
    });
    const list = agents.listByCompany(co.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.adapterName).toBe("claude-oauth-local");
  });
});

describe("agents.setAdapterName (M10 PR-D)", () => {
  it("updates the adapter_name column", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companies = createCompaniesRepository(db);
    const agents = createAgentsRepository(db);
    const co = companies.create({ name: "Co" });
    const agent = agents.create({
      companyId: co.id,
      name: "Mover",
      role: "Engineer",
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(agent.adapterName).toBe("claude-oauth-local");

    agents.setAdapterName(agent.id, "claude-oauth-remote-docker");

    expect(agents.getById(agent.id)?.adapterName).toBe("claude-oauth-remote-docker");
  });
});
