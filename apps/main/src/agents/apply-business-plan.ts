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
  const companies = createCompaniesRepository(db);

  // I3 (audit 2026-06-04) — wrap the status re-check + the chooseOption mirror +
  // the four company/plan mutations in a single better-sqlite3 transaction. This
  // gives two guarantees:
  //   (1) atomicity — a crash/abort mid-way (e.g. the 3rd of 4 UPDATEs throws)
  //       rolls the whole batch back instead of leaving a half-applied company.
  //   (2) idempotency / TOCTOU-safety — the status is re-read INSIDE the
  //       transaction; a second (racing) apply finds status !== 'proposed' and
  //       returns ok:false without re-running any mutation or paid TELOS.
  // The transaction returns the result; throwing inside aborts AND rolls back.
  const apply = db.transaction((): ApplyBusinessPlanResult => {
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
  });

  // A returned ok:false (bad index / not proposed) leaves the early mutations
  // untouched because none ran before the guard; only a thrown error rolls back.
  return apply();
};
