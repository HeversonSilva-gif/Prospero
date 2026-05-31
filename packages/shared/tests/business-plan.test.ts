import { describe, it, expectTypeOf } from "vitest";
import type { BusinessPlan, BusinessPlanStatus } from "../src/types/business-plan.js";

describe("BusinessPlan types", () => {
  it("status union includes the lifecycle states", () => {
    expectTypeOf<BusinessPlanStatus>().toEqualTypeOf<
      "critiquing" | "proposed" | "approved" | "rejected" | "superseded"
    >();
  });
  it("identity carries name, voice, proposed X handle", () => {
    const p = { identity: {} } as unknown as BusinessPlan;
    expectTypeOf(p.identity.name).toBeString();
    expectTypeOf(p.identity.voice).toBeString();
    expectTypeOf(p.identity.proposedXHandle).toBeString();
  });
});
