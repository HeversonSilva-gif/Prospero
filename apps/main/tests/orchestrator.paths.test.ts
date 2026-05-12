import { describe, expect, it } from "vitest";
import { getAgentSandboxCwd, getAgentConfigDir } from "../src/orchestrator/util/paths.js";
import { sep } from "node:path";

describe("orchestrator/util/paths", () => {
  it("getAgentSandboxCwd returns userDataDir/agent-sandbox/<id>/cwd", () => {
    const p = getAgentSandboxCwd("/data", "agent_1");
    expect(p.split(sep).join("/")).toBe("/data/agent-sandbox/agent_1/cwd");
  });

  it("getAgentConfigDir returns userDataDir/agent-sandbox/<id>", () => {
    const p = getAgentConfigDir("/data", "agent_1");
    expect(p.split(sep).join("/")).toBe("/data/agent-sandbox/agent_1");
  });
});
