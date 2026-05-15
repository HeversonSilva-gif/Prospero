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
});
