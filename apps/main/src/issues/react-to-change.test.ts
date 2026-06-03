import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { createIssuesRepository } from "./repository.js";
import { reactToIssueChange } from "./react-to-change.js";
import type { RunVerificationDeps } from "../verification/index.js";

const deps: RunVerificationDeps = {
  sandboxRootFor: () => process.cwd(),
  callMetricTool: () => Promise.resolve({}),
  runCommand: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
};

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1', ?, 'A', 'engineer', '', '[]', '[]', 'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
  ).run(companyId);
  const goalsRepo = createGoalsRepository(db);
  const g = goalsRepo.create({ companyId, title: "G", ownerAgentId: "a1" });
  for (const s of ["planning", "proposed", "approved", "in_progress"] as const) {
    goalsRepo.updateStatus(g.id, s);
  }
  return { db, companyId, goalId: g.id, goalsRepo };
};

const makeIssue = (db: Database.Database, companyId: string, goalId: string): string => {
  const issue = createIssuesRepository(db).create({
    companyId,
    title: "I",
    projectId: null,
    description: null,
    assigneeId: "a1",
    priority: "medium",
    parentId: null,
    createdBy: null,
  });
  db.prepare("UPDATE issues SET goal_id = ? WHERE id = ?").run(goalId, issue.id);
  return issue.id;
};

describe("reactToIssueChange", () => {
  it("triggers verification when the last issue of an in_progress goal is done (the autonomous-path fix)", () => {
    const { db, companyId, goalId, goalsRepo } = setup();
    const issueId = makeIssue(db, companyId, goalId);
    // A pending judgment criterion keeps the goal in `verifying` after the gate,
    // so the assertion is deterministic regardless of async run timing.
    createGoalCriteriaRepository(db).create({ goalId, statement: "on brand", kind: "judgment" });
    createIssuesRepository(db).update(
      issueId,
      { status: "done" },
      { actorKind: "agent", actorId: "a1" },
    );

    reactToIssueChange(db, issueId, deps);

    expect(goalsRepo.getById(goalId)?.status).toBe("verifying");
  });

  it("returns the dependents unlocked when an issue with dependents is completed", () => {
    const { db, companyId, goalId } = setup();
    const dep = makeIssue(db, companyId, goalId); // the dependency
    const blocked = createIssuesRepository(db).create({
      companyId,
      title: "blocked",
      projectId: null,
      description: null,
      assigneeId: "a1",
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    db.prepare("UPDATE issues SET goal_id = ?, depends_on_json = ? WHERE id = ?").run(
      goalId,
      JSON.stringify([dep]),
      blocked.id,
    );
    createIssuesRepository(db).update(
      dep,
      { status: "done" },
      { actorKind: "agent", actorId: "a1" },
    );

    const unlocked = reactToIssueChange(db, dep, deps);

    expect(unlocked.map((i) => i.id)).toContain(blocked.id);
  });
});
