import { z } from "zod";
import { WireErrorCode, WireHandlerError } from "@prospero/shared";
import type { RunnerState } from "../state.js";

const killParamsSchema = z.object({ agentId: z.string().min(1) });

/**
 * Terminates a running agent's child. The child's exit listener (wired in the
 * spawn handler) emits the `exit` notification and deregisters the agent — kill
 * does not do that itself, so there is one cleanup path. Throws WireHandlerError
 * on malformed params or an unknown agent.
 */
export const handleKill = (params: unknown, state: RunnerState): Record<string, never> => {
  const parsed = killParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new WireHandlerError(WireErrorCode.protocolMismatch, "kill: invalid params");
  }
  const agent = state.agents.get(parsed.data.agentId);
  if (agent === undefined) {
    throw new WireHandlerError(
      WireErrorCode.agentNotFound,
      `kill: no agent '${parsed.data.agentId}'`,
    );
  }
  agent.child.kill();
  return {};
};
