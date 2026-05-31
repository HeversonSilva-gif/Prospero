import { describe, it, expect } from "vitest";
import { buildCapabilityBoundary } from "./capability-boundary.js";

describe("buildCapabilityBoundary", () => {
  it("lists what the AI can deliver (SaaS, writing, organization, automation)", () => {
    const text = buildCapabilityBoundary(["x"]);
    for (const k of ["SaaS", "writing", "organization", "automation"]) {
      expect(text.toLowerCase()).toContain(k.toLowerCase());
    }
  });

  it("excludes work the AI cannot do unaided (design, manual fulfillment)", () => {
    const text = buildCapabilityBoundary(["x"]).toLowerCase();
    expect(text).toContain("design");
    expect(text).toContain("cannot");
  });

  it("mentions X as the first marketing channel only when x is available", () => {
    expect(buildCapabilityBoundary(["x"]).toLowerCase()).toContain("x (text");
    expect(buildCapabilityBoundary([]).toLowerCase()).not.toContain("x (text");
  });

  it("does not promise a channel that is not available", () => {
    expect(buildCapabilityBoundary(["x"]).toLowerCase()).not.toContain("instagram");
  });
});
