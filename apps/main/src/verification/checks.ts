// Deterministic ISC checks for the verification engine (spec §6.3).
// All three check kinds resolve to a CriterionResult. The command and metric
// runners are injected via VerifyContext so the checks unit-test without
// spawning processes or touching the MCP registry.

import type Database from "better-sqlite3";
import type {
  ArtifactCheckSpec,
  CommandCheckSpec,
  CriterionResult,
  GoalCriterion,
  MetricCheckSpec,
} from "@prospero/shared";
import { createIssuesRepository } from "../issues/repository.js";
import { createArtifactsRepository } from "../artifacts/repository.js";
import { minimalVerificationEnv } from "./sandbox.js";
import type { RunSandboxedCommandInput, SandboxedCommandResult } from "./sandbox.js";

export interface VerifyContext {
  db: Database.Database;
  // The goal owner's sandbox directory — where command checks run.
  sandboxRoot: string;
  runCommand: (input: RunSandboxedCommandInput) => Promise<SandboxedCommandResult>;
  // Resolves and invokes a Prospero MCP tool by name; throws if unavailable.
  callMetricTool: (tool: string, params: Record<string, unknown>) => Promise<unknown>;
}

const TRUNCATE = 4000;

const checkCommand = async (
  c: GoalCriterion,
  spec: CommandCheckSpec,
  ctx: VerifyContext,
): Promise<CriterionResult> => {
  const run = await ctx.runCommand({
    command: spec.command,
    cwd: ctx.sandboxRoot,
    timeoutMs: spec.timeoutMs,
    env: minimalVerificationEnv(),
  });
  const passed = !run.timedOut && run.exitCode === spec.expectedExitCode;
  const detail = run.timedOut
    ? `timeout ${spec.timeoutMs}ms`
    : passed
      ? `exit ${run.exitCode}`
      : `exit ${run.exitCode}, expected ${spec.expectedExitCode}`;
  return {
    criterionId: c.id,
    status: passed ? "passed" : "failed",
    detail,
    resultJson: {
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      stdout: run.stdout.slice(-TRUNCATE),
      stderr: run.stderr.slice(-TRUNCATE),
    },
  };
};

const getField = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc === "object" && acc !== null) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);

const compare = (op: MetricCheckSpec["operator"], a: number, b: number): boolean => {
  switch (op) {
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "eq":
      return a === b;
  }
};

const checkMetric = async (
  c: GoalCriterion,
  spec: MetricCheckSpec,
  ctx: VerifyContext,
): Promise<CriterionResult> => {
  let raw: unknown;
  try {
    raw = await ctx.callMetricTool(spec.tool, spec.params);
  } catch (err) {
    return {
      criterionId: c.id,
      status: "failed",
      detail: `metric tool error: ${err instanceof Error ? err.message : String(err)}`,
      resultJson: { error: err instanceof Error ? err.message : String(err) },
    };
  }
  const value = getField(raw, spec.field);
  if (typeof value !== "number" || Number.isNaN(value)) {
    return {
      criterionId: c.id,
      status: "failed",
      detail: `field "${spec.field}" is not a number`,
      resultJson: { value },
    };
  }
  const passed = compare(spec.operator, value, spec.threshold);
  return {
    criterionId: c.id,
    status: passed ? "passed" : "failed",
    detail: `${spec.field}=${value} ${spec.operator} ${spec.threshold}`,
    resultJson: { value, operator: spec.operator, threshold: spec.threshold },
  };
};

const checkArtifact = (
  c: GoalCriterion,
  spec: ArtifactCheckSpec,
  ctx: VerifyContext,
): CriterionResult => {
  const issues = createIssuesRepository(ctx.db).listByGoal(c.goalId);
  const artifactsRepo = createArtifactsRepository(ctx.db);
  const re = spec.refPattern !== undefined ? new RegExp(spec.refPattern) : null;
  for (const issue of issues) {
    for (const artifact of artifactsRepo.listByIssue(issue.id)) {
      if (artifact.kind === spec.artifactKind && (re === null || re.test(artifact.ref))) {
        return {
          criterionId: c.id,
          status: "passed",
          detail: `artifact ${artifact.kind}: ${artifact.ref}`,
          resultJson: { matched: true, ref: artifact.ref },
        };
      }
    }
  }
  return {
    criterionId: c.id,
    status: "failed",
    detail: `no ${spec.artifactKind} artifact found on this goal's issues`,
    resultJson: { matched: false },
  };
};

// Runs the deterministic check for one criterion. A deterministic criterion
// with no checkSpec is a malformed criterion — it fails.
export const checkDeterministic = async (
  c: GoalCriterion,
  ctx: VerifyContext,
): Promise<CriterionResult> => {
  const spec = c.checkSpec;
  if (spec === null) {
    return {
      criterionId: c.id,
      status: "failed",
      detail: "deterministic criterion has no check spec",
      resultJson: null,
    };
  }
  switch (spec.checkType) {
    case "command":
      return checkCommand(c, spec, ctx);
    case "metric":
      return checkMetric(c, spec, ctx);
    case "artifact_exists":
      return Promise.resolve(checkArtifact(c, spec, ctx));
  }
};
