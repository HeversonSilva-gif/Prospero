import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { initRecall } from "./index.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import type { ActivityEventRow } from "@prospero/shared";
import type { Router } from "../orchestrator/router.js";

// C1 (audit 2026-06-03 Inteligência & Contexto): the recall observer must seed
// the new assignee when an `issue.assignee_changed` activity is recorded. MAIN
// now re-records that event for the autonomous (MCP assign_issue) path, so this
// proves the observer consumes the exact shape MAIN records → recall reaches the
// delegated agent instead of dying.
describe("initRecall observer", () => {
  it("parks a recall seed for the new assignee on issue.assignee_changed", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const agent = createAgentsRepository(db).create({
      companyId: co.id,
      name: "Sarah",
      role: "engineer",
      systemPrompt: "x",
      mode: "supervised",
      alwaysOn: false,
      model: "claude-sonnet-4-6",
      templateId: "role-engineer",
    });
    const issue = createIssuesRepository(db).create({
      companyId: co.id,
      projectId: null,
      title: "Deploy the API to staging",
      description: "use docker compose",
      assigneeId: agent.id,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    // A company-global lesson recall should surface for this issue's text.
    createMemoriesRepository(db).create({
      companyId: co.id,
      agentId: null,
      kind: "rule",
      body: "the staging deploy uses docker compose, not plain docker",
    });

    const seeds: { agentId: string; seed: string }[] = [];
    const fakeRouter = {
      setPendingSeedIfAbsent: (agentId: string, seed: string) => seeds.push({ agentId, seed }),
    } as unknown as Router;

    const { onActivity } = initRecall(db, fakeRouter);
    onActivity({
      id: "ae1",
      companyId: co.id,
      actorKind: "agent",
      actorId: agent.id,
      action: "issue.assignee_changed",
      entityKind: "issue",
      entityId: issue.id,
      agentId: agent.id,
      payload: { from: null, to: agent.id },
      createdAt: Date.now(),
    } as unknown as ActivityEventRow);

    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.agentId).toBe(agent.id);
    expect(seeds[0]?.seed.toLowerCase()).toContain("docker");
  });

  it("does not seed when there is no new assignee (to is null)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const seeds: unknown[] = [];
    const fakeRouter = {
      setPendingSeedIfAbsent: () => seeds.push(1),
    } as unknown as Router;
    const { onActivity } = initRecall(db, fakeRouter);
    onActivity({
      id: "ae2",
      companyId: co.id,
      actorKind: "agent",
      actorId: null,
      action: "issue.assignee_changed",
      entityKind: "issue",
      entityId: "iss_x",
      agentId: null,
      payload: { from: "a1", to: null },
      createdAt: Date.now(),
    } as unknown as ActivityEventRow);
    expect(seeds).toHaveLength(0);
  });
});
