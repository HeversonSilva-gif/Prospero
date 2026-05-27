import type { PolicyConfig, PolicyVerdict } from "@prospero/shared";
import { isReadOnlyTool } from "../../trust/read-only-tools.js";
import type { ApprovalKind, ManagerTopic } from "../types.js";

export type PolicyInput = {
  kind: ApprovalKind;
  toolName?: string;
  estimatedSpendUsd?: number;
  managerTopic?: ManagerTopic;
  budgetOverLimit?: boolean;
};

export const evaluatePolicies = (req: PolicyInput, config: PolicyConfig): PolicyVerdict => {
  if (req.kind === "manager_request") {
    return {
      kind: "route",
      relaxedFires: config.ceoCanDecideFires && req.managerTopic === "fire" ? true : false,
      relaxedBudgets:
        config.ceoCanDecideBudgetOverruns && req.budgetOverLimit === true ? true : false,
    };
  }
  if (config.autoApproveReadOnlyAcrossProjects && isReadOnlyTool(req.toolName ?? "")) {
    return { kind: "auto-approve", reason: "policy: read-only allowed" };
  }
  if (
    config.autoApproveSpendUnderUsdPerDay !== null &&
    req.estimatedSpendUsd !== undefined &&
    req.estimatedSpendUsd < config.autoApproveSpendUnderUsdPerDay
  ) {
    return { kind: "auto-approve", reason: "policy: spend under cap" };
  }
  return { kind: "route", relaxedFires: false, relaxedBudgets: false };
};
