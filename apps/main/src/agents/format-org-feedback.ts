import type { GenericRole } from "./org-plan-critique.js";

// Re-engages the CEO to deepen an org plan whose charters read generic. Mirrors
// the goal-plan [FEEDBACK] convention; the org-architect system-prompt block
// teaches the CEO to resubmit via submit_org_plan in response.
export const formatOrgPlanFeedback = (genericRoles: GenericRole[]): string => {
  const lines = [
    "[ORG_PLAN_FEEDBACK]",
    "Some role charters in your last org plan read generic — they would fit any",
    "company. Deepen them (anchor to this business, concrete Operating Workflow,",
    "specific Domain Lenses) and resubmit the whole plan via submit_org_plan.",
    "",
  ];
  for (const r of genericRoles) {
    lines.push(`- ${r.name}: ${r.feedback}`);
  }
  return lines.join("\n");
};
