import type { ProposedRole } from "@prospero/shared";
import { critiqueCharter, type CritiqueDeps } from "./charter-critic.js";
import { decidePlanOutcome } from "./plan-outcome.js";

// Reuse the charter layer's deps alias rather than re-declaring the shape — the
// charter critic aliases CritiqueDeps = GenerateCharterDeps for exactly this
// anti-drift reason, and critiqueCharter (called below) expects this type.
export type OrgPlanCritiqueDeps = CritiqueDeps;

export type OrgPlanCritiqueInput = {
  roles: ProposedRole[];
  businessContext: string;
  env: Record<string, string>;
  companyId: string;
};

export type GenericRole = { name: string; feedback: string };

// Critiques every proposed role's charter in parallel against the business
// context, collecting the roles whose charter reads generic or shallow. Reuses
// the fail-open charter critic from the one-shot path, so a critic hiccup yields a
// passing verdict and never blocks org design.
export const critiqueOrgPlan = async (
  deps: OrgPlanCritiqueDeps,
  input: OrgPlanCritiqueInput,
): Promise<{ genericRoles: GenericRole[] }> => {
  const verdicts = await Promise.all(
    input.roles.map((r) =>
      critiqueCharter(deps, {
        charter: r.charter,
        businessContext: input.businessContext,
        env: input.env,
        companyId: input.companyId,
      }).then((c) => ({ name: r.name, c })),
    ),
  );
  const genericRoles = verdicts
    .filter(({ c }) => !c.specific || !c.depthOk)
    .map(({ name, c }) => ({ name, feedback: c.feedback }));
  return { genericRoles };
};

// Thin adapter over decidePlanOutcome that preserves the original
// `{ genericCount, attempts, cap } → "card" | "revise"` contract so that
// orchestrator-handlers.ts and existing tests need no changes.
export const decideOrgPlanOutcome = (input: {
  genericCount: number;
  attempts: number;
  cap: number;
}): "card" | "revise" =>
  decidePlanOutcome({
    flaggedCount: input.genericCount,
    attempts: input.attempts,
    cap: input.cap,
  }) === "revise"
    ? "revise"
    : "card";
