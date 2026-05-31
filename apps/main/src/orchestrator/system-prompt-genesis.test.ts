import { describe, it, expect } from "vitest";
import { genesisSystemPromptBlock } from "./system-prompt-genesis.js";

describe("genesisSystemPromptBlock", () => {
  it("teaches the CEO to call submit_business_plan", () => {
    expect(genesisSystemPromptBlock).toContain("submit_business_plan");
  });
  it("frames X as the first channel, not the business (INV-1)", () => {
    expect(genesisSystemPromptBlock.toLowerCase()).toContain("first marketing channel");
    expect(genesisSystemPromptBlock.toLowerCase()).toContain("not an x account");
  });
  it("states the feasibility constraint (INV-2)", () => {
    expect(genesisSystemPromptBlock.toLowerCase()).toContain("build, run, and maintain");
  });
  it("interviews then proposes ONE business", () => {
    expect(genesisSystemPromptBlock.toLowerCase()).toContain("interview");
    expect(genesisSystemPromptBlock.toLowerCase()).toContain("one");
  });
  it("handles [BUSINESS_PLAN_FEEDBACK] by resubmitting", () => {
    expect(genesisSystemPromptBlock).toContain("[BUSINESS_PLAN_FEEDBACK]");
    expect(genesisSystemPromptBlock.toLowerCase()).toContain("resubmit");
  });
  it("tells the CEO the team comes after approval", () => {
    expect(genesisSystemPromptBlock.toLowerCase()).toContain("propose the team");
  });
});
