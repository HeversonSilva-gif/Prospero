import type Database from "better-sqlite3";
import { createBusinessPlansRepository } from "./business-plans-repository.js";
import { createCompaniesRepository } from "../companies/repository.js";

export type ApplyBusinessPlanResult =
  | { ok: true; companyId: string; ceoAgentId: string; brandName: string }
  | { ok: false; error: string };

// Synchronous approval mutations. The slower, fail-soft TELOS synthesis runs in
// the IPC handler after this returns (it needs the derivation runner + env).
// `chosenIndex` — when non-null and the plan has options, re-mirrors
// options[chosenIndex] into the flat columns before applying.
// Pass null (or omit via legacy callers) for single-option legacy plans.
export const applyBusinessPlan = (
  db: Database.Database,
  businessPlanId: string,
  chosenIndex: number | null = null,
): ApplyBusinessPlanResult => {
  const plans = createBusinessPlansRepository(db);
  let plan = plans.getById(businessPlanId);
  if (plan === null) return { ok: false, error: "business plan not found" };
  if (plan.status !== "proposed") {
    return { ok: false, error: `business plan is ${plan.status}, not proposed` };
  }

  // P4.2 — re-mirror the chosen option into flat columns before applying.
  if (chosenIndex !== null && plan.options !== null) {
    const mirrored = plans.chooseOption(businessPlanId, chosenIndex);
    if (!mirrored) {
      return { ok: false, error: `chosenIndex ${chosenIndex} is out of range` };
    }
    // Re-read so the flat columns reflect the chosen option.
    plan = plans.getById(businessPlanId)!;
  }

  const companies = createCompaniesRepository(db);
  companies.rename(plan.companyId, plan.identity.name);
  companies.setBrandIdentity(plan.companyId, {
    voice: plan.identity.voice,
    proposedXHandle: plan.identity.proposedXHandle,
  });
  if (plan.ownerProfile !== null) companies.setOwnerProfile(plan.companyId, plan.ownerProfile);

  if (chosenIndex !== null) {
    plans.markApprovedWithOption(businessPlanId, chosenIndex);
  } else {
    plans.markApproved(businessPlanId);
  }

  return {
    ok: true,
    companyId: plan.companyId,
    ceoAgentId: plan.proposedByAgentId,
    brandName: plan.identity.name,
  };
};
