import { describe, it, expect } from "vitest";
import { deriveOnboardingPhase, ONBOARDING_PHASES } from "./onboarding.js";

describe("deriveOnboardingPhase", () => {
  it("interviewing → negocio", () => {
    expect(
      deriveOnboardingPhase({ teamSize: 0, businessPlanProposed: false, orgPlanProposed: false }),
    ).toBe("negocio");
  });
  it("business plan proposed → plano", () => {
    expect(
      deriveOnboardingPhase({ teamSize: 0, businessPlanProposed: true, orgPlanProposed: false }),
    ).toBe("plano");
  });
  it("org plan proposed → time (outranks business plan)", () => {
    expect(
      deriveOnboardingPhase({ teamSize: 0, businessPlanProposed: true, orgPlanProposed: true }),
    ).toBe("time");
  });
  it("team exists → projeto", () => {
    expect(
      deriveOnboardingPhase({ teamSize: 2, businessPlanProposed: false, orgPlanProposed: false }),
    ).toBe("projeto");
  });
  it("phase order is negocio, plano, time, projeto", () => {
    expect(ONBOARDING_PHASES).toEqual(["negocio", "plano", "time", "projeto"]);
  });
});
