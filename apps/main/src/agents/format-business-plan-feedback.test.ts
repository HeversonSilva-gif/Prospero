import { describe, it, expect } from "vitest";
import { formatBusinessPlanFeedback } from "./format-business-plan-feedback.js";

describe("formatBusinessPlanFeedback", () => {
  it("opens with the marker and tells the CEO to resubmit", () => {
    const msg = formatBusinessPlanFeedback("needs design; too generic");
    expect(msg).toContain("[BUSINESS_PLAN_FEEDBACK]");
    expect(msg).toContain("submit_business_plan");
    expect(msg).toContain("needs design; too generic");
  });
});
