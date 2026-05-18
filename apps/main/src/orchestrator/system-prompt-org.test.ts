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
