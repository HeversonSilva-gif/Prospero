import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "./repository.js";
import { createGoalCriteriaRepository } from "./criteria-repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createIssueCriteriaRepository } from "./issue-criteria-repository.js";

describe("issueCriteriaRepository", () => {
  let db: Database.Database;
  let issueId: string;
  let critId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
    const goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
    critId = createGoalCriteriaRepository(db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
    }).id;
    issueId = createIssuesRepository(db).create({
      companyId,
      projectId: null,
      title: "I",
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    }).id;
  });

  it("link then listCriteriaForIssue round-trips", () => {
    const repo = createIssueCriteriaRepository(db);
    repo.link(issueId, critId);
    expect(repo.listCriteriaForIssue(issueId)).toEqual([critId]);
  });

  it("link is idempotent", () => {
    const repo = createIssueCriteriaRepository(db);
    repo.link(issueId, critId);
    repo.link(issueId, critId);
    expect(repo.listCriteriaForIssue(issueId)).toEqual([critId]);
  });

  it("listIssuesForCriterion returns the linked issues", () => {
    const repo = createIssueCriteriaRepository(db);
    repo.link(issueId, critId);
    expect(repo.listIssuesForCriterion(critId)).toEqual([issueId]);
  });
});
