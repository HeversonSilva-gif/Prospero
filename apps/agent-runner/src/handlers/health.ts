import type { HealthResult } from "@prospero/shared";
import type { RunnerState } from "../state.js";

/**
 * Liveness snapshot. `activeAgents` is always 0 in PR-B.1 — it becomes the live
 * count once PR-B.2 adds the spawned-agent registry. `now` is injectable for
 * deterministic tests.
 */
export const handleHealth = (state: RunnerState, now: number = Date.now()): HealthResult => ({
  ok: true,
  uptimeSeconds: Math.floor((now - state.startedAt) / 1000),
  activeAgents: 0,
});
