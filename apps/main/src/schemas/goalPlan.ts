// M8.5 — Zod schema for submit_goal_plan MCP tool payload.
//
// Lives in apps/main (not packages/shared) because zod is a runtime
// dependency. Putting it in shared bundles zod into the preload sandbox
// which doesn't resolve node_modules (see project_m7_6_lessons.md fix #1).
// TS interfaces for the same shapes live in packages/shared/src/types/goal.ts.

import { z } from "zod";
import { MODEL_PRESETS } from "../agents/model-presets.js";

export { MODEL_PRESETS } from "../agents/model-presets.js";

const indexRef = z.union([z.number().int().nonnegative(), z.literal("CEO")]);

// An issue's assignee can be: a fresh hire (index into agentsToHire), the CEO, OR
// an EXISTING team member by id ({ existingAgentId }). The last form is what lets
// a plan REUSE the team the company already has — the CEO is instructed to reuse
// (list_agents → "REUSE when it makes sense") but without this had no way to
// express it, so it could only assign to itself or to brand-new hires.
const assigneeRef = z.union([
  z.number().int().nonnegative(),
  z.literal("CEO"),
  z.object({ existingAgentId: z.string().min(1) }),
]);

const AgentToHireSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1).max(80),
  roleTemplateId: z.string().min(1),
  model: z.enum(MODEL_PRESETS),
  personaSummary: z.string().min(10).max(500),
  capabilities: z.array(z.string()).max(20),
  reportsToIndex: indexRef,
  rationale: z.string().min(1).max(500),
});

const IssueToCreateSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  assigneeIndex: assigneeRef,
  estimatedTokens: z.number().int().positive(),
  dependsOnIndexes: z.array(z.number().int().nonnegative()).max(20),
  advancesCriteria: z.array(z.string().min(1).max(120)).max(50).optional(),
  rationale: z.string().min(1).max(500),
});

const RiskSchema = z.object({
  description: z.string().min(1).max(500),
  mitigation: z.string().min(1).max(500),
  severity: z.enum(["low", "medium", "high"]),
});

const checkSequentialIndexes = <T extends { index: number }>(
  items: T[],
  ctx: z.RefinementCtx,
  label: string,
): void => {
  const seen = new Set<number>();
  for (const it of items) {
    if (seen.has(it.index)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} index ${it.index} is duplicated`,
      });
    }
    seen.add(it.index);
  }
  for (let i = 0; i < items.length; i++) {
    if (!seen.has(i)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} indexes must be sequential 0..N-1 (missing ${i})`,
      });
    }
  }
};

const hasCycle = (n: number, edges: (i: number) => number[]): boolean => {
  const color = new Array<number>(n).fill(0);
  const dfs = (u: number): boolean => {
    color[u] = 1;
    for (const v of edges(u)) {
      if (v < 0 || v >= n) continue;
      if (color[v] === 1) return true;
      if (color[v] === 0 && dfs(v)) return true;
    }
    color[u] = 2;
    return false;
  };
  for (let i = 0; i < n; i++) {
    if (color[i] === 0 && dfs(i)) return true;
  }
  return false;
};

export const GoalPlanPayloadSchema = z
  .object({
    summary: z.string().min(20).max(2000),
    agentsToHire: z.array(AgentToHireSchema).max(20),
    // I-zero (audit 2026-06-03): a plan must create at least one issue. A
    // zero-issue plan traps its goal in in_progress forever — both the
    // verification trigger and the reconciler require issues.length > 0, so
    // nothing ever moves it to verifying.
    issuesToCreate: z.array(IssueToCreateSchema).min(1).max(50),
    estimatedTotalTokens: z.number().int().positive().nullable().optional(),
    estimatedDurationDays: z.number().int().positive().nullable().optional(),
    estimatedCostCents: z.number().int().nonnegative().nullable().optional(),
    risks: z.array(RiskSchema).max(10),
  })
  .superRefine((data, ctx) => {
    checkSequentialIndexes(data.agentsToHire, ctx, "agentsToHire");
    checkSequentialIndexes(data.issuesToCreate, ctx, "issuesToCreate");

    const agentCount = data.agentsToHire.length;
    const issueCount = data.issuesToCreate.length;

    for (const a of data.agentsToHire) {
      if (a.reportsToIndex !== "CEO") {
        const r = a.reportsToIndex;
        if (r < 0 || r >= agentCount) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `agentsToHire[${a.index}].reportsToIndex ${r} is out of range`,
          });
        }
        if (r === a.index) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `agentsToHire[${a.index}] cannot report to itself`,
          });
        }
      }
    }

    const reportsCycle = hasCycle(agentCount, (i) => {
      const r = data.agentsToHire[i]?.reportsToIndex;
      return typeof r === "number" ? [r] : [];
    });
    if (reportsCycle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agentsToHire reports_to forms a cycle",
      });
    }

    for (const i of data.issuesToCreate) {
      // Only the numeric (fresh-hire index) form is range-checked here. "CEO" and
      // the { existingAgentId } form reference agents that exist at execution time,
      // not at parse time — the executor validates the id against the live roster.
      if (typeof i.assigneeIndex === "number") {
        const a = i.assigneeIndex;
        if (a < 0 || a >= agentCount) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `issuesToCreate[${i.index}].assigneeIndex ${a} is out of range`,
          });
        }
      }
    }

    for (const i of data.issuesToCreate) {
      for (const d of i.dependsOnIndexes) {
        if (d < 0 || d >= issueCount) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `issuesToCreate[${i.index}].dependsOnIndexes contains out-of-range ${d}`,
          });
        }
        if (d === i.index) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `issuesToCreate[${i.index}] cannot depend on itself`,
          });
        }
      }
    }

    const depsCycle = hasCycle(issueCount, (i) => data.issuesToCreate[i]?.dependsOnIndexes ?? []);
    if (depsCycle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "issuesToCreate dependsOnIndexes forms a cycle",
      });
    }
  });

export type GoalPlanPayload = z.infer<typeof GoalPlanPayloadSchema>;
