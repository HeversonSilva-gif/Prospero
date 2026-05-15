import type { HealthResult } from "@prospero/shared";
import type { RunnerState } from "../state.js";

/**
 * Liveness snapshot. `now` is injectable for deterministic tests.
 */
export const handleHealth = (state: RunnerState, now: number = Date.now()): HealthResult => ({
  ok: true,
  uptimeSeconds: Math.floor((now - state.startedAt) / 1000),
  activeAgents: state.agents.size,
});
