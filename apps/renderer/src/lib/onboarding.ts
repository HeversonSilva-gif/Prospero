// The Nova-empresa wizard shows a 4-phase progress stepper. The active phase is
// derived purely from observable company state so it stays correct on reload and
// across live events — there is no separate "wizard step" persisted anywhere.
//
//   negocio → CEO is still interviewing the owner (no plan, no team)
//   plano   → CEO proposed a business plan awaiting review
//   time    → CEO proposed an org plan (team) awaiting review
//   projeto → team exists; next is the first post
export type OnboardingPhase = "negocio" | "plano" | "time" | "projeto";

export const ONBOARDING_PHASES: readonly OnboardingPhase[] = [
  "negocio",
  "plano",
  "time",
  "projeto",
];

export const deriveOnboardingPhase = (input: {
  // Count of company agents that are NOT the CEO and not terminated.
  teamSize: number;
  // Whether a business plan is currently proposed and awaiting review.
  businessPlanProposed: boolean;
  // Whether an org plan is currently proposed and awaiting review.
  orgPlanProposed: boolean;
}): OnboardingPhase => {
  if (input.teamSize > 0) return "projeto";
  if (input.orgPlanProposed) return "time";
  if (input.businessPlanProposed) return "plano";
  return "negocio";
};
