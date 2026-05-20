import { describe, it, expect, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Capture the notify spy that the tool resolves via buildVerificationDeps.
// Mock is hoisted by vitest before the tools-isa import below runs.
const notifySpy = vi.fn<(companyId: string) => void>();
vi.mock("../verification/deps.js", () => ({
  buildVerificationDeps: () => ({
    sandboxRootFor: () => process.cwd(),
    callMetricTool: () => Promise.reject(new Error("not used")),
    notify: notifySpy,
  }),
}));

import { applyMigrations } from "../db/migrations.js";
import { isaToolDefinitions } from "./tools-isa.js";
import type { ToolContext } from "./tools.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createArtifactsRepository } from "../artifacts/repository.js";
import { writeTelos } from "../companies/telos-store.js";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  notifySpy.mockClear();
});

const setup = (): { ctx: ToolContext; goalId: string } => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const userDataDir = mkdtempSync(join(tmpdir(), "tools-isa-"));
  tmps.push(userDataDir);
  const companyId = createCompaniesRepository(db).create({ name: "Acme" }).id;
  // Insert a stub agent row so verified_by FK is satisfied when criterion_judge
  // records the agent as verifier.
  const now = Date.now();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('agent_1', ?, 'Reviewer', 'engineer', '', '[]', '[]', 'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', ?, ?)`,
  ).run(companyId, now, now);
  const goalId = createGoalsRepository(db).create({
    companyId,
    title: "Launch",
    successCriteria: "A polished launch.",
  }).id;
  const ctx: ToolContext = {
    agentId: "agent_1",
    companyId,
    db,
    permissionsDir: "/tmp/perm",
    userDataDir,
    emit: () => {},
  };
  return { ctx, goalId };
};

const isaRead = isaToolDefinitions.find((t) => t.name === "isa_read")!;
const criterionCheck = isaToolDefinitions.find((t) => t.name === "criterion_check")!;
const criterionJudge = isaToolDefinitions.find((t) => t.name === "criterion_judge")!;
const telosRead = isaToolDefinitions.find((t) => t.name === "telos_read")!;

describe("isa_read tool", () => {
  it("returns the materialized ISA body and criteria", async () => {
    const { ctx, goalId } = setup();
    createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
    });
    const out = JSON.parse(await isaRead.run({ goal_id: goalId }, ctx)) as {
      body: string;
      criteria: unknown[];
    };
    expect(out.body).toContain("A polished launch."); // seeded Vision
    expect(out.criteria).toHaveLength(1);
  });

  it("returns a single section when `section` is given", async () => {
    const { ctx, goalId } = setup();
    const out = JSON.parse(await isaRead.run({ goal_id: goalId, section: "Vision" }, ctx)) as {
      section: string;
      text: string;
    };
    expect(out.text).toBe("A polished launch.");
  });

  it("rejects a goal from another company", async () => {
    const { ctx, goalId } = setup();
    await expect(isaRead.run({ goal_id: goalId }, { ...ctx, companyId: "other" })).rejects.toThrow(
      /not found/,
    );
  });

  it("throws when the requested section does not exist", async () => {
    const { ctx, goalId } = setup();
    await expect(isaRead.run({ goal_id: goalId, section: "DoesNotExist" }, ctx)).rejects.toThrow(
      /ISA section not found/,
    );
  });

  it("returns an empty criteria array for a goal with no criteria", async () => {
    const { ctx, goalId } = setup();
    const out = JSON.parse(await isaRead.run({ goal_id: goalId }, ctx)) as {
      criteria: unknown[];
    };
    expect(out.criteria).toEqual([]);
  });
});

describe("criterion_check tool", () => {
  it("runs a deterministic check and returns + persists the result", async () => {
    const { ctx, goalId } = setup();
    const issue = createIssuesRepository(ctx.db).create({
      companyId: ctx.companyId,
      title: "I",
      projectId: null,
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    ctx.db.prepare("UPDATE issues SET goal_id = ? WHERE id = ?").run(goalId, issue.id);
    createArtifactsRepository(ctx.db).create({
      issueId: issue.id,
      kind: "file_path",
      ref: "out/report.md",
      contentPreview: null,
      createdBy: null,
    });
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "report delivered",
      kind: "deterministic",
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path" },
    });
    const out = JSON.parse(await criterionCheck.run({ criterion_id: crit.id }, ctx)) as {
      status: string;
    };
    expect(out.status).toBe("passed");
    expect(createGoalCriteriaRepository(ctx.db).getById(crit.id)?.status).toBe("passed");
  });

  it("returns a failed result when the check does not pass", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "report delivered",
      kind: "deterministic",
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "pr_url" },
    });
    const out = JSON.parse(await criterionCheck.run({ criterion_id: crit.id }, ctx)) as {
      status: string;
    };
    expect(out.status).toBe("failed");
  });

  it("rejects a judgment criterion", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    await expect(criterionCheck.run({ criterion_id: crit.id }, ctx)).rejects.toThrow(
      /deterministic/,
    );
  });

  it("rejects a criterion from another company", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "x",
      kind: "deterministic",
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path" },
    });
    await expect(
      criterionCheck.run({ criterion_id: crit.id }, { ...ctx, companyId: "other" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("criterion_judge tool", () => {
  // Walk a goal to `verifying` so reevaluateGoalFromState has something to gate.
  const toVerifying = (ctx: ToolContext, goalId: string): void => {
    const repo = createGoalsRepository(ctx.db);
    for (const s of ["planning", "proposed", "approved", "in_progress", "verifying"] as const) {
      repo.updateStatus(goalId, s);
    }
  };

  it("records the verdict with the agent as verifier and re-evaluates the goal", async () => {
    const { ctx, goalId } = setup();
    toVerifying(ctx, goalId);
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    await criterionJudge.run({ criterion_id: crit.id, verdict: "passed" }, ctx);
    const fetched = createGoalCriteriaRepository(ctx.db).getById(crit.id);
    expect(fetched?.status).toBe("passed");
    expect(fetched?.verifiedBy).toBe("agent_1");
    expect(createGoalsRepository(ctx.db).getById(goalId)?.status).toBe("achieved");
  });

  it("broadcasts an inbox update so the renderer refreshes after the goal closes", async () => {
    // Mirrors the B1 verifier broadcast (RunVerificationDeps.notify), which the
    // renderer subscribes to via onInboxUpdate. Without this, /goals/:id does
    // not refresh when criterion_judge flips the goal to `achieved`.
    const { ctx, goalId } = setup();
    toVerifying(ctx, goalId);
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    await criterionJudge.run({ criterion_id: crit.id, verdict: "passed" }, ctx);
    expect(notifySpy).toHaveBeenCalledWith(ctx.companyId);
  });

  it("rejects a deterministic criterion", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "tests pass",
      kind: "deterministic",
      checkType: "artifact_exists",
      checkSpec: { checkType: "artifact_exists", artifactKind: "file_path" },
    });
    await expect(
      criterionJudge.run({ criterion_id: crit.id, verdict: "passed" }, ctx),
    ).rejects.toThrow(/judgment/);
  });

  it("rejects an unknown criterion", async () => {
    const { ctx } = setup();
    await expect(
      criterionJudge.run({ criterion_id: "nope", verdict: "passed" }, ctx),
    ).rejects.toThrow(/not found/);
  });

  it("rejects a criterion from another company", async () => {
    const { ctx, goalId } = setup();
    const crit = createGoalCriteriaRepository(ctx.db).create({
      goalId,
      statement: "on brand",
      kind: "judgment",
    });
    await expect(
      criterionJudge.run(
        { criterion_id: crit.id, verdict: "passed" },
        { ...ctx, companyId: "other" },
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("telos_read tool", () => {
  it("returns the company TELOS body", async () => {
    const { ctx } = setup();
    writeTelos(ctx.userDataDir, ctx.companyId, "# Company TELOS\n\n## Mission\n\nShip fast.");
    const out = JSON.parse(await telosRead.run({}, ctx)) as { exists: boolean; body: string };
    expect(out.exists).toBe(true);
    expect(out.body).toContain("Ship fast.");
  });

  it("returns exists:false when the company has no TELOS", async () => {
    const { ctx } = setup();
    const out = JSON.parse(await telosRead.run({}, ctx)) as { exists: boolean };
    expect(out.exists).toBe(false);
  });

  it("returns a single section when `section` is given", async () => {
    const { ctx } = setup();
    writeTelos(ctx.userDataDir, ctx.companyId, "# Company TELOS\n\n## Mission\n\nShip fast.");
    const out = JSON.parse(await telosRead.run({ section: "Mission" }, ctx)) as { text: string };
    expect(out.text).toBe("Ship fast.");
  });
});
