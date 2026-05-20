// M13 — ISA criterion (ISC) shared types.
// Zod schemas live in apps/main/src/schemas/criterionCheckSpec.ts — zod is a
// runtime dep that cannot live in shared (see project_m7_6_lessons: zod in
// shared breaks the preload sandbox bundle).

export type CriterionKind = "deterministic" | "judgment";
// Must stay in sync with the checkType discriminants of CriterionCheckSpec.
export type CriterionCheckType = "command" | "metric" | "artifact_exists";
export type CriterionStatus = "pending" | "passed" | "failed" | "waived";

// check_type='command' — runs a command in the sandbox; passes on exit code.
export interface CommandCheckSpec {
  checkType: "command";
  command: string;
  expectedExitCode: number;
  timeoutMs: number;
}

// check_type='metric' — calls an MCP tool, compares a numeric field.
export interface MetricCheckSpec {
  checkType: "metric";
  tool: string;
  params: Record<string, unknown>;
  field: string;
  operator: "lt" | "lte" | "gt" | "gte" | "eq";
  threshold: number;
}

// check_type='artifact_exists' — checks the issue_artifacts table.
export interface ArtifactCheckSpec {
  checkType: "artifact_exists";
  artifactKind: "file_path" | "commit_sha" | "pr_url" | "snapshot" | "output_text";
  refPattern?: string;
}

export type CriterionCheckSpec = CommandCheckSpec | MetricCheckSpec | ArtifactCheckSpec;

// One ISC — a verifiable criterion of a goal's ISA.
export interface GoalCriterion {
  id: string;
  goalId: string;
  sortOrder: number;
  statement: string;
  kind: CriterionKind;
  // Invariant: checkType and checkSpec are either both non-null (a
  // deterministic criterion) or both null (a judgment criterion). The pair
  // mirrors the goal_criteria.check_type / check_spec DB columns.
  checkType: CriterionCheckType | null;
  checkSpec: CriterionCheckSpec | null;
  status: CriterionStatus;
  // Written by the verification engine (M13 PR-B); always defaults in PR-A.
  lastCheckedAt: number | null;
  lastResultJson: string | null;
  verifiedBy: string | null;
  // M13 PR-D: how many times applyResult has run on this row.
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCriterionInput {
  goalId: string;
  statement: string;
  kind: CriterionKind;
  checkType?: CriterionCheckType | null;
  checkSpec?: CriterionCheckSpec | null;
}

// Full-field update — the panel always edits a complete criterion.
export interface UpdateCriterionInput {
  statement: string;
  kind: CriterionKind;
  checkType: CriterionCheckType | null;
  checkSpec: CriterionCheckSpec | null;
}

// A criterion proposed by AI generation — the user confirms kind and authors
// checkSpec before it becomes a GoalCriterion.
export interface ProposedCriterion {
  statement: string;
  kind: CriterionKind;
  // A hint only — the user authors the full checkSpec in the confirmation step.
  checkType?: CriterionCheckType;
}

// The draft returned by AI-assisted ISA generation.
export interface IsaDraft {
  isa: string;
  criteria: ProposedCriterion[];
}
