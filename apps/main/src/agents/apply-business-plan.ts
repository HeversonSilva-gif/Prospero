import type Database from "better-sqlite3";
import { createBusinessPlansRepository } from "./business-plans-repository.js";
import { createCompaniesRepository } from "../companies/repository.js";

export type ApplyBusinessPlanResult =
  | { ok: true; companyId: string; ceoAgentId: string; brandName: string }
  | { ok: false; error: string };

// Synchronous approval mutations. The slower, fail-soft TELOS synthesis runs in
// the IPC handler after this returns (it needs the derivation runner + env).
export const applyBusinessPlan = (
  db: Database.Database,
  businessPlanId: string,
): ApplyBusinessPlanResult => {
  const plans = createBusinessPlansRepository(db);
  const plan = plans.getById(businessPlanId);
  if (plan === null) return { ok: false, error: "business plan not found" };
  if (plan.status !== "proposed") {
    return { ok: false, error: `business plan is ${plan.status}, not proposed` };
  }
  const companies = createCompaniesRepository(db);
  companies.rename(plan.companyId, plan.identity.name);
  companies.setBrandIdentity(plan.companyId, {
    voice: plan.identity.voice,
    proposedXHandle: plan.identity.proposedXHandle,
  });
  plans.markApproved(businessPlanId);
  return {
    ok: true,
    companyId: plan.companyId,
    ceoAgentId: plan.proposedByAgentId,
    brandName: plan.identity.name,
  };
};
