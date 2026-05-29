// The Nova-empresa wizard shows a 3-phase progress stepper. The active phase is
// derived purely from observable company state so it stays correct on reload and
// across live events — there is no separate "wizard step" persisted anywhere.
//
//   negocio → the CEO is still interviewing the owner (no team, no org proposal)
//   time    → the CEO has proposed an org plan that is awaiting the owner's review
//   projeto → the team exists (org applied); the next move is the first project
export type OnboardingPhase = "negocio" | "time" | "projeto";

export const ONBOARDING_PHASES: readonly OnboardingPhase[] = ["negocio", "time", "projeto"];

export const deriveOnboardingPhase = (input: {
  // Count of company agents that are NOT the CEO and not terminated.
  teamSize: number;
  // Whether an org plan is currently proposed and awaiting review.
  orgPlanProposed: boolean;
}): OnboardingPhase => {
  if (input.teamSize > 0) return "projeto";
  if (input.orgPlanProposed) return "time";
  return "negocio";
};
