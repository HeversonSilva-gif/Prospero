import { describe, expect, it } from "vitest";
import { handleHealth } from "../src/handlers/health.js";
import { createRunnerState } from "../src/state.js";

describe("handleHealth", () => {
  it("reports ok with zero active agents", () => {
    const result = handleHealth(createRunnerState(0), 0);
    expect(result).toEqual({ ok: true, uptimeSeconds: 0, activeAgents: 0 });
  });

  it("computes uptime in whole seconds from the start time", () => {
    const result = handleHealth(createRunnerState(1_000), 6_500);
    expect(result.uptimeSeconds).toBe(5);
  });

  it("reports the live agent count", () => {
    const state = createRunnerState(0);
    state.agents.set("a1", {
      child: { pid: 1, stdin: null, stdout: null, stderr: null, kill: () => {}, on: () => {} },
      sandbox: { configDir: "/c", workDir: "/w" },
      mcp: { port: 0, writeToBridge: () => {}, close: () => {} },
    });
    expect(handleHealth(state, 0).activeAgents).toBe(1);
  });
});
