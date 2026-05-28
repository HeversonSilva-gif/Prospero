import { describe, it, expect } from "vitest";
import { buildLibrarianPrompt } from "./prompts.js";

describe("buildLibrarianPrompt", () => {
  it("lists each skill with its id, counts, and truncated body", () => {
    const p = buildLibrarianPrompt([
      {
        id: "s1",
        name: "a",
        description: "does a",
        useCount: 5,
        viewCount: 9,
        patchCount: 0,
        trust: 0.6,
        lifecycleState: "active",
        body: "BODY-A",
      },
      {
        id: "s2",
        name: "b",
        description: "does b",
        useCount: 0,
        viewCount: 9,
        patchCount: 0,
        trust: 0.6,
        lifecycleState: "stale",
        body: "BODY-B",
      },
    ]);
    expect(p).toContain("s1");
    expect(p).toContain("does a");
    expect(p).toContain("BODY-A");
    expect(p).toMatch(/JSON/i);
    expect(p).toContain("merge");
    expect(p).toContain("archive");
  });
});
