import { describe, it, expect } from "vitest";
import { compactionTarget } from "./compaction-target.js";

describe("compactionTarget", () => {
  it("exactly one allowed project → project-scoped digest", () => {
    expect(compactionTarget({ id: "ag_1", allowedProjects: ["pr_9"] })).toEqual({
      kind: "project",
      projectId: "pr_9",
    });
  });

  it("empty allowedProjects ([] = all projects, e.g. CEO) → agent-scoped digest", () => {
    expect(compactionTarget({ id: "ag_ceo", allowedProjects: [] })).toEqual({
      kind: "agent",
      agentId: "ag_ceo",
    });
  });

  it("multiple allowed projects → agent-scoped digest (no single fold target)", () => {
    expect(compactionTarget({ id: "ag_2", allowedProjects: ["pr_a", "pr_b"] })).toEqual({
      kind: "agent",
      agentId: "ag_2",
    });
  });
});
