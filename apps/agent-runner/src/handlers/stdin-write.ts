import { z } from "zod";
import { WireErrorCode, WireHandlerError } from "@prospero/shared";
import type { RunnerState } from "../state.js";

const stdinWriteParamsSchema = z.object({
  agentId: z.string().min(1),
  line: z.string(),
});

/**
 * Writes one line of JSONL to a running agent's stdin. Throws WireHandlerError
 * on malformed params or an unknown agent.
 */
export const handleStdinWrite = (params: unknown, state: RunnerState): Record<string, never> => {
  const parsed = stdinWriteParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new WireHandlerError(WireErrorCode.protocolMismatch, "stdin-write: invalid params");
  }
  const agent = state.agents.get(parsed.data.agentId);
  if (agent === undefined) {
    throw new WireHandlerError(
      WireErrorCode.agentNotFound,
      `stdin-write: no agent '${parsed.data.agentId}'`,
    );
  }
  agent.child.stdin?.write(parsed.data.line);
  return {};
};
