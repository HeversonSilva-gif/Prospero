import { describe, expect, it } from "vitest";
import { getAgentSandboxCwd, getAgentConfigDir } from "../src/orchestrator/util/paths.js";
import { sep } from "node:path";

describe("orchestrator/util/paths", () => {
  // Short layout (v0.1.38 MAX_PATH fix): shortAgentSlug("agent_1") === "1".
  it("getAgentSandboxCwd returns userDataDir/sbx/<slug>/c", () => {
    const p = getAgentSandboxCwd("/data", "agent_1");
    expect(p.split(sep).join("/")).toBe("/data/sbx/1/c");
  });

  it("getAgentConfigDir returns userDataDir/sbx/<slug>", () => {
    const p = getAgentConfigDir("/data", "agent_1");
    expect(p.split(sep).join("/")).toBe("/data/sbx/1");
  });
});
