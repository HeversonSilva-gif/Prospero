import { describe, it, expect } from "vitest";
import { orgArchitectSystemPromptBlock } from "./system-prompt-org.js";

describe("orgArchitectSystemPromptBlock", () => {
  it("teaches the CEO to call submit_org_plan", () => {
    expect(orgArchitectSystemPromptBlock).toContain("submit_org_plan");
  });

  it("tells the CEO to write a full charter per role", () => {
    expect(orgArchitectSystemPromptBlock.toLowerCase()).toContain("charter");
  });
});

describe("org-architect charter depth rubric", () => {
  it("tells the CEO to anchor charters to THIS business and avoid boilerplate", () => {
    expect(orgArchitectSystemPromptBlock).toContain("specific to this business");
    expect(orgArchitectSystemPromptBlock).toContain("Operating Workflow");
    expect(orgArchitectSystemPromptBlock.toLowerCase()).toContain("boilerplate");
  });
});
