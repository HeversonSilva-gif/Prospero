import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const agents = createAgentsRepository(db);
  const company = companies.create({ name: "Kronos" });
  return { agents, companyId: company.id };
};

describe("agents repository", () => {
  it("create + listByCompany + getById", () => {
    const { agents, companyId } = setup();
    const ceo = agents.create({
      companyId,
      name: "CEO",
      role: "Chief Executive Officer",
      systemPrompt: "You are CEO.",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(ceo.status).toBe("idle");
    expect(agents.listByCompany(companyId)).toHaveLength(1);
    expect(agents.getById(ceo.id)?.name).toBe("CEO");
  });

  it("updateStatus mutates status and currentAction", () => {
    const { agents, companyId } = setup();
    const a = agents.create({
      companyId,
      name: "A",
      role: "x",
      systemPrompt: "x",
      mode: "auto",
      alwaysOn: false,
    });
    agents.updateStatus(a.id, { status: "thinking", currentAction: "considering" });
    const after = agents.getById(a.id);
    expect(after?.status).toBe("thinking");
    expect(after?.currentAction).toBe("considering");
  });

  it("setSessionId persists claude session id", () => {
    const { agents, companyId } = setup();
    const a = agents.create({
      companyId,
      name: "A",
      role: "x",
      systemPrompt: "x",
      mode: "auto",
      alwaysOn: false,
    });
    agents.setSessionId(a.id, "sess_123");
    expect(agents.getById(a.id)?.claudeSessionId).toBe("sess_123");
  });
});
