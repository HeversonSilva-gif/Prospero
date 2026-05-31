import { describe, it, expect } from "vitest";
import { formatOrgPlanFeedback } from "./format-org-feedback.js";

describe("formatOrgPlanFeedback", () => {
  it("lists each generic role with its feedback under an [ORG_PLAN_FEEDBACK] header", () => {
    const msg = formatOrgPlanFeedback([
      { name: "Engineer", feedback: "Name the product." },
      { name: "Writer", feedback: "Anchor to the audience." },
    ]);
    expect(msg).toContain("[ORG_PLAN_FEEDBACK]");
    expect(msg).toContain("submit_org_plan");
    expect(msg).toContain("Engineer: Name the product.");
    expect(msg).toContain("Writer: Anchor to the audience.");
  });
});
