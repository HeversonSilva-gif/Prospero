import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createGoalsRepository } from "../src/goals/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { maybeStartVerification } from "../src/verification/trigger.js";
import type { RunVerificationDeps } from "../src/verification/index.js";

const deps: RunVerificationDeps = {
  sandboxRootFor: () => process.cwd(),
  callMetricTool: () => Promise.resolve({}),
  runCommand: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
};

describe("maybeStartVerification", () => {
  let db: Database.Database;
  let companyId: string;
  let goalId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
    const repo = createGoalsRepository(db);
    const g = repo.create({ companyId, title: "G" });
    repo.updateStatus(g.id, "planning");
    repo.updateStatus(g.id, "proposed");
    repo.updateStatus(g.id, "approved");
    repo.updateStatus(g.id, "in_progress");
    goalId = g.id;
  });

  const linkedIssue = (status: "todo" | "done") => {
    const issue = createIssuesRepository(db).create({
      companyId,
      title: "I",
      projectId: null,
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    db.prepare("UPDATE issues SET goal_id = ?, status = ? WHERE id = ?").run(
      goalId,
      status,
      issue.id,
    );
    return createIssuesRepository(db).getById(issue.id)!;
  };

  it("transitions the goal to verifying when the last issue is done", () => {
    linkedIssue("done");
    const last = linkedIssue("done");
    maybeStartVerification(db, last, deps);
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("verifying");
  });

  it("does nothing while an issue is still open", () => {
    linkedIssue("todo");
    const done = linkedIssue("done");
    maybeStartVerification(db, done, deps);
    expect(createGoalsRepository(db).getById(goalId)?.status).toBe("in_progress");
  });

  it("does nothing for an issue with no goal", () => {
    const issue = createIssuesRepository(db).create({
      companyId,
      title: "free",
      projectId: null,
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    const done = createIssuesRepository(db).getById(issue.id)!;
    expect(() => maybeStartVerification(db, done, deps)).not.toThrow();
  });
});
