import { describe, it, expect } from "vitest";
import { deriveOnboardingPhase } from "./onboarding.js";

describe("deriveOnboardingPhase", () => {
  it("starts in 'negocio' — only the CEO, no org proposal", () => {
    expect(deriveOnboardingPhase({ teamSize: 0, orgPlanProposed: false })).toBe("negocio");
  });

  it("advances to 'time' once an org plan is proposed", () => {
    expect(deriveOnboardingPhase({ teamSize: 0, orgPlanProposed: true })).toBe("time");
  });

  it("advances to 'projeto' once the team exists, regardless of org proposal state", () => {
    expect(deriveOnboardingPhase({ teamSize: 2, orgPlanProposed: false })).toBe("projeto");
    expect(deriveOnboardingPhase({ teamSize: 2, orgPlanProposed: true })).toBe("projeto");
  });
});
