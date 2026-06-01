import { describe, it, expect } from "vitest";
import { buildGenesisSystemPromptBlock } from "./system-prompt-genesis.js";
import { buildCapabilityBoundary } from "../agents/genesis/capability-boundary.js";

// Built the way build-args composes it for the CEO: the real capability boundary
// embedded in the genesis block.
const block = buildGenesisSystemPromptBlock(buildCapabilityBoundary(["x"]));

describe("buildGenesisSystemPromptBlock", () => {
  it("teaches the CEO to call submit_business_plan", () => {
    expect(block).toContain("submit_business_plan");
  });
  it("frames X as the first channel, not the business (INV-1)", () => {
    expect(block.toLowerCase()).toContain("first marketing channel");
    expect(block.toLowerCase()).toContain("not an x account");
  });
  it("states the feasibility constraint (INV-2)", () => {
    expect(block.toLowerCase()).toContain("build, run, and maintain");
  });
  it("instructs a concrete pricing model (P5.2)", () => {
    expect(block).toContain("pricing");
    expect(block.toLowerCase()).toContain("subscription");
  });
  it("instructs web competitor research (P-steal #2)", () => {
    expect(block.toLowerCase()).toContain("competitor");
    expect(block).toContain("research");
  });
  it("instructs an owner profile (P-steal #4)", () => {
    expect(block).toContain("ownerProfile");
  });
  it("embeds the capability boundary so its limit reaches the CEO (INV-2)", () => {
    // The boundary prose ("cannot" do design, etc.) must be present in the block,
    // not just referenced — otherwise "the capability section above" is dangling.
    expect(block).toContain("SaaS");
    expect(block.toLowerCase()).toContain("cannot");
  });
  it("interviews then proposes ONE business", () => {
    expect(block.toLowerCase()).toContain("interview");
    expect(block.toLowerCase()).toContain("one");
  });
  it("handles [BUSINESS_PLAN_FEEDBACK] by resubmitting", () => {
    expect(block).toContain("[BUSINESS_PLAN_FEEDBACK]");
    expect(block.toLowerCase()).toContain("resubmit");
  });
  it("tells the CEO the team comes after approval", () => {
    expect(block.toLowerCase()).toContain("propose the team");
  });
});
