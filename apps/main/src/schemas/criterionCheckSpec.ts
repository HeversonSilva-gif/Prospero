// Zod validation for goal_criteria.check_spec. Lives in apps/main (not
// @prospero/shared) because zod is a runtime dep that cannot enter the shared
// package — see project_m7_6_lessons. Shape matches the CriterionCheckSpec
// discriminated union in @prospero/shared/types/isa.ts.

import { z } from "zod";

const commandCheckSpec = z.object({
  checkType: z.literal("command"),
  command: z.string().min(1).max(2000),
  expectedExitCode: z.number().int(),
  timeoutMs: z.number().int().positive().max(3_600_000),
});

const metricCheckSpec = z.object({
  checkType: z.literal("metric"),
  tool: z.string().min(1).max(200),
  params: z.record(z.unknown()),
  field: z.string().min(1).max(200),
  operator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
  threshold: z.number(),
});

const artifactCheckSpec = z.object({
  checkType: z.literal("artifact_exists"),
  artifactKind: z.enum(["file_path", "commit_sha", "pr_url", "snapshot", "output_text"]),
  refPattern: z.string().max(500).optional(),
});

export const criterionCheckSpecSchema = z.discriminatedUnion("checkType", [
  commandCheckSpec,
  metricCheckSpec,
  artifactCheckSpec,
]);

export type CriterionCheckSpecParsed = z.infer<typeof criterionCheckSpecSchema>;
