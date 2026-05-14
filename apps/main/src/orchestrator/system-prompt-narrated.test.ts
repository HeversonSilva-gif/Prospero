import { describe, it, expect } from "vitest";
import { buildNarratedBlock } from "./system-prompt-narrated.js";

describe("buildNarratedBlock", () => {
  it("mentions the 4 narrated tools", () => {
    const block = buildNarratedBlock();
    expect(block).toContain("hire_agent_for_plan");
    expect(block).toContain("create_issue_for_plan");
    expect(block).toContain("comment_on_issue");
    expect(block).toContain("finalize_goal_execution");
  });

  it("instructs to call finalize when done", () => {
    expect(buildNarratedBlock()).toMatch(/finalize_goal_execution/i);
  });

  it("instructs to retry/skip/abort on error", () => {
    expect(buildNarratedBlock()).toMatch(/retry|skip|abort/i);
  });
});
