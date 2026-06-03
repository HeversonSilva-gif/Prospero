import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createArtifactsRepository } from "../artifacts/repository.js";
import { checkDeterministic } from "./checks.js";
import type { VerifyContext } from "./checks.js";
import type { GoalCriterion } from "@prospero/shared";

const baseCtx = (db: Database.Database): VerifyContext => ({
  db,
  sandboxRoot: process.cwd(),
  runCommand: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
  callMetricTool: () => Promise.resolve({}),
});

describe("checkDeterministic", () => {
  let db: Database.Database;
  let goalId: string;
  let companyId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
    goalId = createGoalsRepository(db).create({ companyId, title: "G" }).id;
  });

  const mkCriterion = (over: Partial<GoalCriterion>): GoalCriterion =>
    createGoalCriteriaRepository(db).create({
      goalId,
      statement: over.statement ?? "x",
      kind: "deterministic",
      checkType: over.checkType ?? "command",
      checkSpec:
        over.checkSpec ??
        ({
          checkType: "command",
          command: "pnpm test",
          expectedExitCode: 0,
          timeoutMs: 1000,
        } as const),
    });

  it("command check passes when the exit code matches", async () => {
    const c = mkCriterion({});
    const r = await checkDeterministic(c, baseCtx(db));
    expect(r.status).toBe("passed");
  });

  it("command check fails on a wrong exit code", async () => {
    const c = mkCriterion({});
    const ctx: VerifyContext = {
      ...baseCtx(db),
      runCommand: () =>
        Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom", timedOut: false }),
    };
    const r = await checkDeterministic(c, ctx);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("exit 1");
  });

  it("command check fails on a timeout", async () => {
    const c = mkCriterion({});
    const ctx: VerifyContext = {
      ...baseCtx(db),
      runCommand: () => Promise.resolve({ exitCode: 124, stdout: "", stderr: "", timedOut: true }),
    };
    const r = await checkDeterministic(c, ctx);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("timeout");
  });

  it("metric check passes when the field satisfies the operator", async () => {
    const c = mkCriterion({
      checkType: "metric",
      checkSpec: {
        checkType: "metric",
        tool: "fake_metric",
        params: {},
        field: "data.cpa",
        operator: "lt",
        threshold: 50,
      },
    });
    const passCtx: VerifyContext = {
      ...baseCtx(db),
      callMetricTool: () => Promise.resolve({ data: { cpa: 30 } }),
    };
    expect((await checkDeterministic(c, passCtx)).status).toBe("passed");
  });

  it("metric check fails when the field violates the operator", async () => {
    const c = mkCriterion({
      checkType: "metric",
      checkSpec: {
        checkType: "metric",
        tool: "fake_metric",
        params: {},
        field: "data.cpa",
        operator: "lt",
        threshold: 50,
      },
    });
    const failCtx: VerifyContext = {
      ...baseCtx(db),
      callMetricTool: () => Promise.resolve({ data: { cpa: 80 } }),
    };
    expect((await checkDeterministic(c, failCtx)).status).toBe("failed");
  });

  it("metric check is WAIVED (not failed) when the tool is unavailable", async () => {
    // In production callMetricTool is not wired (always rejects). A throw here
    // is not the agent's fault, so it must NOT mark the criterion `failed` —
    // that would block the goal AND demote the owner's trust for a check the
    // system can't run. Waive it instead (Audit Facet 5 I1).
    const c = mkCriterion({
      checkType: "metric",
      checkSpec: {
        checkType: "metric",
        tool: "missing_tool",
        params: {},
        field: "x",
        operator: "eq",
        threshold: 1,
      },
    });
    const ctx: VerifyContext = {
      ...baseCtx(db),
      callMetricTool: () => Promise.reject(new Error("tool not found")),
    };
    const r = await checkDeterministic(c, ctx);
    expect(r.status).toBe("waived");
    expect(r.detail).toContain("tool not found");
  });

  it("artifact_exists check passes when a matching artifact exists", async () => {
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
    db.prepare("UPDATE issues SET goal_id = ? WHERE id = ?").run(goalId, issue.id);
    createArtifactsRepository(db).create({
      issueId: issue.id,
      kind: "file_path",
      ref: "out/report.md",
      contentPreview: null,
      createdBy: null,
    });
    const c = mkCriterion({
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path" },
    });
    const r = await checkDeterministic(c, baseCtx(db));
    expect(r.status).toBe("passed");
  });

  it("artifact_exists check fails when no artifact matches", async () => {
    const c = mkCriterion({
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "pr_url" },
    });
    const r = await checkDeterministic(c, baseCtx(db));
    expect(r.status).toBe("failed");
  });

  it("artifact_exists check matches a refPattern", async () => {
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
    db.prepare("UPDATE issues SET goal_id = ? WHERE id = ?").run(goalId, issue.id);
    createArtifactsRepository(db).create({
      issueId: issue.id,
      kind: "file_path",
      ref: "out/report.md",
      contentPreview: null,
      createdBy: null,
    });
    const c = mkCriterion({
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path", refPattern: "\\.md$" },
    });
    expect((await checkDeterministic(c, baseCtx(db))).status).toBe("passed");
  });

  it("artifact_exists check fails an invalid refPattern cleanly", async () => {
    const c = mkCriterion({
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path", refPattern: "[" },
    });
    const r = await checkDeterministic(c, baseCtx(db));
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("invalid refPattern");
  });
});
