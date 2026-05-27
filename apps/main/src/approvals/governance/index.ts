import type { GovernanceConfig, GovernanceResult } from "@prospero/shared";
import { evaluatePolicies, type PolicyInput } from "./policies.js";
import { isInQuietHours } from "./quiet-hours.js";

export const applyGovernance = (
  req: PolicyInput,
  config: GovernanceConfig,
  now: Date,
): GovernanceResult => {
  const verdict = evaluatePolicies(req, config.policies);
  if (verdict.kind === "auto-approve") return verdict;
  const inQuiet = isInQuietHours(now, config.quietHours);
  return {
    kind: "route",
    relaxedFires: verdict.relaxedFires || inQuiet,
    relaxedBudgets: verdict.relaxedBudgets || inQuiet,
  };
};
