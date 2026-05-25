import { describe, it, expect } from "vitest";
import { projectDigestPath, relativeDigestPath } from "./digest-dir.js";

describe("digest-dir", () => {
  it("derives a path under companies/<cid>/projects/<pid>", () => {
    const p = projectDigestPath("/data", "co_1", "pr_2");
    expect(p.replace(/\\/g, "/")).toContain("companies/co_1/projects/pr_2/digest.json");
  });

  it("rejects unsafe ids", () => {
    expect(() => projectDigestPath("/data", "../etc", "pr_2")).toThrow();
  });

  it("relativeDigestPath is forward-slash stable", () => {
    expect(relativeDigestPath("co_1", "pr_2")).toBe("companies/co_1/projects/pr_2/digest.json");
  });
});
