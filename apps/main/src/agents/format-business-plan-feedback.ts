// Re-engages the CEO to fix a business plan flagged as generic or infeasible. The
// genesis system-prompt block teaches the CEO to resubmit via submit_business_plan.
export const formatBusinessPlanFeedback = (feedback: string): string =>
  [
    "[BUSINESS_PLAN_FEEDBACK]",
    "Your last business plan was rejected on review — it is too generic or not",
    "something your AI team can build, run, and maintain on its own. Fix this and",
    "resubmit the whole plan via submit_business_plan:",
    "",
    feedback.trim() === ""
      ? "- Make it more concrete and clearly AI-deliverable."
      : `- ${feedback.trim()}`,
  ].join("\n");
