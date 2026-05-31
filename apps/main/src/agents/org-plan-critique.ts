import type Database from "better-sqlite3";
import type { ProposedRole } from "@prospero/shared";
import type { RunDerivationResult } from "../derivation/runner.js";
import { critiqueCharter } from "./charter-critic.js";

export type OrgPlanCritiqueDeps = {
  db: Database.Database;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
};

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

// Pure decision: re-engage the CEO with feedback (`revise`) only when there are
// generic charters AND a revision attempt remains; otherwise surface the proposal
// (`card`). Keeping this pure makes the main-process branch trivial to reason about.
export const decideOrgPlanOutcome = (input: {
  genericCount: number;
  attempts: number;
  cap: number;
}): "card" | "revise" => (input.genericCount > 0 && input.attempts < input.cap ? "revise" : "card");
