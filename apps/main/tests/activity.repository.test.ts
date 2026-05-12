import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createRecorder } from "../src/activity/recorder.js";
import { createActivityRepository } from "../src/activity/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const companyA = companies.create({ name: "A" });
  const companyB = companies.create({ name: "B" });
  const recorder = createRecorder(db, vi.fn(), { devMode: true });
  const repo = createActivityRepository(db);
  return { recorder, repo, companyA: companyA.id, companyB: companyB.id };
};

describe("activity repository", () => {
  it("query returns rows ordered desc by createdAt", async () => {
    const { recorder, repo, companyA } = setup();
    recorder.recordActivity({
      companyId: companyA,
      actor: { kind: "user" },
      action: "project.created",
      entityKind: "project",
      entityId: "proj_1",
      payload: { name: "First" },
    });
    await new Promise((r) => setTimeout(r, 5));
    recorder.recordActivity({
      companyId: companyA,
      actor: { kind: "user" },
      action: "project.created",
      entityKind: "project",
      entityId: "proj_2",
      payload: { name: "Second" },
    });
    const rows = repo.query({ companyId: companyA });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.entityId).toBe("proj_2");
    expect(rows[1]!.entityId).toBe("proj_1");
  });

  it("filters by entity_kind", () => {
    const { recorder, repo, companyA } = setup();
    recorder.recordActivity({
      companyId: companyA,
      actor: { kind: "user" },
      action: "project.created",
      entityKind: "project",
      entityId: "proj_1",
      payload: { name: "X" },
    });
    recorder.recordActivity({
      companyId: companyA,
      actor: { kind: "user" },
      action: "issue.created",
      entityKind: "issue",
      entityId: "iss_1",
      payload: { identifier: "X-1", title: "T", assigneeAgentId: null },
    });
    const rows = repo.query({ companyId: companyA, filters: { entityKind: "issue" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityKind).toBe("issue");
  });

  it("filters by agent_id", () => {
    const { recorder, repo, companyA } = setup();
    recorder.recordActivity({
      companyId: companyA,
      actor: { kind: "agent", id: "agent_alice" },
      action: "issue.created",
      entityKind: "issue",
      entityId: "iss_1",
      payload: { identifier: "X-1", title: "T", assigneeAgentId: null },
    });
    recorder.recordActivity({
      companyId: companyA,
      actor: { kind: "agent", id: "agent_bob" },
      action: "issue.created",
      entityKind: "issue",
      entityId: "iss_2",
      payload: { identifier: "X-2", title: "T2", assigneeAgentId: null },
    });
    const rows = repo.query({ companyId: companyA, filters: { agentId: "agent_alice" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentId).toBe("agent_alice");
  });

  it("cursor pagination respects limit + beforeCreatedAt/beforeId", () => {
    const { recorder, repo, companyA } = setup();
    for (let i = 0; i < 5; i += 1) {
      recorder.recordActivity({
        companyId: companyA,
        actor: { kind: "user" },
        action: "project.created",
        entityKind: "project",
        entityId: `proj_${i}`,
        payload: { name: `p${i}` },
      });
    }
    const firstPage = repo.query({ companyId: companyA, limit: 2 });
    expect(firstPage).toHaveLength(2);
    const cursor = {
      beforeCreatedAt: firstPage[1]!.createdAt,
      beforeId: firstPage[1]!.id,
    };
    const secondPage = repo.query({ companyId: companyA, limit: 2, cursor });
    expect(secondPage).toHaveLength(2);
    expect(secondPage[0]!.id).not.toBe(firstPage[0]!.id);
    expect(secondPage[0]!.id).not.toBe(firstPage[1]!.id);
  });

  it("cross-company isolation: query(companyA) never returns companyB rows", () => {
    const { recorder, repo, companyA, companyB } = setup();
    recorder.recordActivity({
      companyId: companyA,
      actor: { kind: "user" },
      action: "project.created",
      entityKind: "project",
      entityId: "proj_a",
      payload: { name: "A" },
    });
    recorder.recordActivity({
      companyId: companyB,
      actor: { kind: "user" },
      action: "project.created",
      entityKind: "project",
      entityId: "proj_b",
      payload: { name: "B" },
    });
    const rowsA = repo.query({ companyId: companyA });
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]!.entityId).toBe("proj_a");
  });
});
