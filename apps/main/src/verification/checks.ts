// Deterministic ISC checks for the verification engine (spec §6.3).
// All three check kinds resolve to a CriterionResult. The command and metric
// runners are injected via VerifyContext so the checks unit-test without
// spawning processes or touching the MCP registry.

import { access } from "node:fs/promises";
import { resolve as pathResolve, relative as pathRelative, isAbsolute } from "node:path";
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
  // Injectable for tests; defaults to fs.access. Resolves a file_path artifact.
  fileExists?: (absPath: string) => Promise<boolean>;
}

const defaultFileExists = async (absPath: string): Promise<boolean> => {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
};

// A commit ref we'll feed to `git cat-file`: hex, 7..64 chars (short SHA-1
// through full SHA-256). The bound also blocks shell-injection via the ref.
const HEX_COMMIT_REF = /^[a-f0-9]{7,64}$/i;

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
    // The metric tool is not wired in production (callMetricTool rejects), so a
    // throw means "the system can't verify this", NOT "the agent failed". Mark
    // it WAIVED, not failed: failing here would both block the goal and demote
    // the owner's trust (verificationFailures) for a check we never ran. Audit
    // 2026-06-03 Facet 5 I1. (Real fix: wire callMetricTool or drop metric ISCs
    // from ISA generation.) A tool that RETURNS a bad value still fails below.
    const message = err instanceof Error ? err.message : String(err);
    return {
      criterionId: c.id,
      status: "waived",
      detail: `metric tool unavailable (${spec.tool}); waived — cannot verify automatically: ${message}`,
      resultJson: { waived: true, reason: "metric_tool_unavailable", error: message },
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

// C7a (audit 2026-06-03): resolve an artifact's ref against reality, not just
// match the DB row. A bare row is falsifiable — an agent records any commit_sha
// / file_path and the criterion "passes" without the work existing.
//   commit_sha  -> `git cat-file -e <ref>^{commit}` in the goal owner's sandbox
//   file_path   -> the file exists under the sandbox (no traversal escape)
//   pr_url      -> cannot verify offline -> WAIVED (neither falsely pass nor fail)
//   snapshot/output_text -> inline evidence stored with the artifact (row = proof)
const resolveArtifactRef = async (
  kind: ArtifactCheckSpec["artifactKind"],
  ref: string,
  ctx: VerifyContext,
): Promise<{ status: "passed" | "failed" | "waived"; detail: string }> => {
  if (kind === "commit_sha") {
    if (!HEX_COMMIT_REF.test(ref)) {
      return { status: "failed", detail: `commit_sha ref is not a hex sha: ${ref}` };
    }
    const run = await ctx.runCommand({
      command: `git cat-file -e ${ref}^{commit}`,
      cwd: ctx.sandboxRoot,
      timeoutMs: 10_000,
      env: minimalVerificationEnv(),
    });
    return !run.timedOut && run.exitCode === 0
      ? { status: "passed", detail: `commit ${ref} exists` }
      : { status: "failed", detail: `commit ${ref} not found (git cat-file exit ${run.exitCode})` };
  }
  if (kind === "file_path") {
    const abs = pathResolve(ctx.sandboxRoot, ref);
    const rel = pathRelative(ctx.sandboxRoot, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      return { status: "failed", detail: `file_path escapes the sandbox: ${ref}` };
    }
    const exists = await (ctx.fileExists ?? defaultFileExists)(abs);
    return exists
      ? { status: "passed", detail: `file ${ref} exists` }
      : { status: "failed", detail: `file ${ref} not found in sandbox` };
  }
  if (kind === "pr_url") {
    // Verifying a PR needs network + credentials the sandbox doesn't have.
    // Don't auto-pass on presence (falsifiable) nor auto-fail (we can't check).
    return { status: "waived", detail: `pr_url present but not auto-verifiable offline: ${ref}` };
  }
  // snapshot / output_text: the artifact row carries the deliverable inline.
  return { status: "passed", detail: `${kind} artifact recorded` };
};

const checkArtifact = async (
  c: GoalCriterion,
  spec: ArtifactCheckSpec,
  ctx: VerifyContext,
): Promise<CriterionResult> => {
  let re: RegExp | null = null;
  if (spec.refPattern !== undefined) {
    try {
      re = new RegExp(spec.refPattern);
    } catch {
      return {
        criterionId: c.id,
        status: "failed",
        detail: `invalid refPattern: ${spec.refPattern}`,
        resultJson: { error: "invalid_regex" },
      };
    }
  }
  const issues = createIssuesRepository(ctx.db).listByGoal(c.goalId);
  const artifactsRepo = createArtifactsRepository(ctx.db);
  let matched = false;
  let lastDetail = `no ${spec.artifactKind} artifact found on this goal's issues`;
  for (const issue of issues) {
    for (const artifact of artifactsRepo.listByIssue(issue.id)) {
      if (artifact.kind !== spec.artifactKind || (re !== null && !re.test(artifact.ref))) continue;
      matched = true;
      const res = await resolveArtifactRef(spec.artifactKind, artifact.ref, ctx);
      if (res.status === "passed") {
        return {
          criterionId: c.id,
          status: "passed",
          detail: `artifact ${artifact.kind}: ${artifact.ref} — ${res.detail}`,
          resultJson: { matched: true, ref: artifact.ref, resolved: true },
        };
      }
      if (res.status === "waived") {
        return {
          criterionId: c.id,
          status: "waived",
          detail: res.detail,
          resultJson: { matched: true, ref: artifact.ref, resolved: false, waived: true },
        };
      }
      // A matching row that did NOT resolve — keep scanning for one that does.
      lastDetail = res.detail;
    }
  }
  return {
    criterionId: c.id,
    status: "failed",
    detail: matched ? lastDetail : `no ${spec.artifactKind} artifact found on this goal's issues`,
    resultJson: { matched },
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
      return checkArtifact(c, spec, ctx);
  }
};
