// M12 PR-D2 — Zod schema for the submit_org_plan MCP tool payload.
//
// Lives in apps/main (not packages/shared) because zod is a runtime dependency
// — putting it in shared bundles zod into the preload sandbox. The plain TS
// interfaces for the same shapes are in packages/shared/src/types/org-plan.ts.
//
// Indexes are 0-based and sequential (0..N-1), matching the goal plan schema.

import { z } from "zod";
import { MODEL_PRESETS } from "../agents/model-presets.js";

const indexRef = z.union([z.number().int().nonnegative(), z.literal("CEO")]);

const ProposedRoleSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  charter: z.string().min(1).max(20000),
  model: z.enum(MODEL_PRESETS),
  capabilities: z.array(z.string()).max(20),
  icon: z.string().max(16).nullable(),
});

const ProposedAgentSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1).max(80),
  roleIndex: z.number().int().nonnegative(),
  reportsToIndex: indexRef,
  rationale: z.string().min(1).max(500),
});

// Duplicate / non-sequential index check, shared by roles and agents.
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

// DFS cycle detection over a directed graph of n nodes.
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

export const OrgPlanPayloadSchema = z
  .object({
    summary: z.string().min(20).max(2000),
    roles: z.array(ProposedRoleSchema).min(1).max(20),
    agents: z.array(ProposedAgentSchema).min(1).max(20),
  })
  .superRefine((data, ctx) => {
    checkSequentialIndexes(data.roles, ctx, "roles");
    checkSequentialIndexes(data.agents, ctx, "agents");

    const roleCount = data.roles.length;
    const agentCount = data.agents.length;

    for (const a of data.agents) {
      if (a.roleIndex < 0 || a.roleIndex >= roleCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `agents[${a.index}].roleIndex ${a.roleIndex} is out of range`,
        });
      }
      if (a.reportsToIndex !== "CEO") {
        const r = a.reportsToIndex;
        if (r < 0 || r >= agentCount) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `agents[${a.index}].reportsToIndex ${r} is out of range`,
          });
        }
        if (r === a.index) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `agents[${a.index}] cannot report to itself`,
          });
        }
      }
    }

    const cycle = hasCycle(agentCount, (i) => {
      const r = data.agents[i]?.reportsToIndex;
      return typeof r === "number" ? [r] : [];
    });
    if (cycle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agents reportsTo forms a cycle",
      });
    }
  });

export type OrgPlanPayload = z.infer<typeof OrgPlanPayloadSchema>;
