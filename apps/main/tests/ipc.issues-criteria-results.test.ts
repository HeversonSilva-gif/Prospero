// Tests for the issues:list-criteria-results IPC handler.
// Strategy: instantiate the handler directly (not via ipcMain.handle) by
// extracting the query logic through a thin helper that mirrors the handler.

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createGoalsRepository } from "../src/goals/repository.js";
import { createGoalCriteriaRepository } from "../src/goals/criteria-repository.js";
import type { IssueCriterionResult } from "@prospero/shared";

// Replicate the query from the IPC handler so we can test it without Electron.
const listCriteriaResults = (db: Database.Database, issueId: string): IssueCriterionResult[] => {
  type Row = { id: string; statement: string; kind: string; status: string };
  const rows = db
    .prepare(
      `SELECT gc.id, gc.statement, gc.kind, gc.status
       FROM issue_criteria ic
       JOIN goal_criteria gc ON gc.id = ic.criterion_id
       WHERE ic.issue_id = ?
       ORDER BY gc.sort_order ASC`,
    )
    .all(issueId) as Row[];

  return rows.map((r) => {
    let status: IssueCriterionResult["status"];
    if (r.status === "passed" || r.status === "waived") {
      status = "pass";
    } else if (r.status === "failed") {
      status = "fail";
    } else {
      status = "pending";
    }
    return {
      id: r.id,
      text: r.statement,
      kind: r.kind as "deterministic" | "judgment",
      status,
    };
  });
};

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
  const goalId = createGoalsRepository(db).create({ companyId, title: "Launch" }).id;
  const criteria = createGoalCriteriaRepository(db);
  // Insert a minimal issue row without going through the repository
  // (avoids side-effects like notifyAssignee writing event files).
  const issueId = `issue_test_${Date.now()}`;
  db.prepare(
    `INSERT INTO issues (id, company_id, project_id, parent_id, title, description,
       assignee_id, status, priority, identifier, issue_number, created_by,
       created_at, updated_at)
     VALUES (?, ?, NULL, NULL, 'Test issue', NULL, NULL, 'todo', 'medium',
       NULL, NULL, NULL, ?, ?)`,
  ).run(issueId, companyId, Date.now(), Date.now());

  return { db, companyId, goalId, criteria, issueId };
};

describe("issues:list-criteria-results IPC", () => {
  it("returns empty array for an issue with no linked criteria", () => {
    const { db, issueId } = setup();
    const result = listCriteriaResults(db, issueId);
    expect(result).toEqual([]);
  });

  it("returns criteria with default pending status for linked criteria", () => {
    const { db, goalId, criteria, issueId } = setup();
    const det = criteria.create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "command",
      checkSpec: {
        checkType: "command",
        command: "npm test",
        expectedExitCode: 0,
        timeoutMs: 60000,
      },
    });
    const judg = criteria.create({ goalId, statement: "CEO reviewed", kind: "judgment" });
    db.prepare("INSERT INTO issue_criteria (issue_id, criterion_id) VALUES (?, ?)").run(
      issueId,
      det.id,
    );
    db.prepare("INSERT INTO issue_criteria (issue_id, criterion_id) VALUES (?, ?)").run(
      issueId,
      judg.id,
    );

    const result = listCriteriaResults(db, issueId);

    expect(result).toHaveLength(2);

    const detResult = result.find((r) => r.id === det.id);
    expect(detResult).toBeDefined();
    expect(detResult!.kind).toBe("deterministic");
    expect(detResult!.status).toBe("pending");
    expect(detResult!.text).toBe("tests pass");

    const judgResult = result.find((r) => r.id === judg.id);
    expect(judgResult).toBeDefined();
    expect(judgResult!.kind).toBe("judgment");
    expect(judgResult!.status).toBe("pending");
  });

  it("maps passed and failed statuses correctly", () => {
    const { db, goalId, criteria, issueId } = setup();
    const c1 = criteria.create({
      goalId,
      statement: "deployed",
      kind: "deterministic",
      checkType: "command",
      checkSpec: { checkType: "command", command: "echo ok", expectedExitCode: 0, timeoutMs: 1000 },
    });
    const c2 = criteria.create({
      goalId,
      statement: "smoke test",
      kind: "deterministic",
      checkType: "command",
      checkSpec: {
        checkType: "command",
        command: "echo fail",
        expectedExitCode: 0,
        timeoutMs: 1000,
      },
    });
    db.prepare("INSERT INTO issue_criteria (issue_id, criterion_id) VALUES (?, ?)").run(
      issueId,
      c1.id,
    );
    db.prepare("INSERT INTO issue_criteria (issue_id, criterion_id) VALUES (?, ?)").run(
      issueId,
      c2.id,
    );

    db.prepare("UPDATE goal_criteria SET status = 'passed' WHERE id = ?").run(c1.id);
    db.prepare("UPDATE goal_criteria SET status = 'failed' WHERE id = ?").run(c2.id);

    const result = listCriteriaResults(db, issueId);

    expect(result.find((r) => r.id === c1.id)!.status).toBe("pass");
    expect(result.find((r) => r.id === c2.id)!.status).toBe("fail");
  });

  it("maps waived status to pass", () => {
    const { db, goalId, criteria, issueId } = setup();
    const c = criteria.create({ goalId, statement: "waived criterion", kind: "judgment" });
    db.prepare("INSERT INTO issue_criteria (issue_id, criterion_id) VALUES (?, ?)").run(
      issueId,
      c.id,
    );
    db.prepare("UPDATE goal_criteria SET status = 'waived' WHERE id = ?").run(c.id);

    const result = listCriteriaResults(db, issueId);
    expect(result[0]!.status).toBe("pass");
  });
});
