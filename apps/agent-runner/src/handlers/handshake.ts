import { z } from "zod";
import {
  WIRE_PROTOCOL_VERSION,
  WireErrorCode,
  WireHandlerError,
  type HandshakeResult,
} from "@prospero/shared";
import type { RunnerState } from "../state.js";

const RUNNER_SERVER_NAME = "agent-runner";
const RUNNER_SERVER_VERSION = "0.1.0";

const handshakeParamsSchema = z.object({
  protocolVersion: z.number(),
  client: z.string(),
  clientVersion: z.string(),
  credentials: z.object({
    kind: z.string(),
    oauthToken: z.string().min(1),
  }),
});

/**
 * Validates a handshake, records the credentials on the runner state, and
 * returns the server's handshake result. Throws WireHandlerError on malformed
 * params, a protocol-version mismatch, or an unsupported credential kind, so
 * the WireServer maps it to an error response.
 */
export const handleHandshake = (params: unknown, state: RunnerState): HandshakeResult => {
  const parsed = handshakeParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new WireHandlerError(WireErrorCode.protocolMismatch, "handshake: invalid params");
  }
  if (parsed.data.protocolVersion !== WIRE_PROTOCOL_VERSION) {
    throw new WireHandlerError(
      WireErrorCode.unsupportedProtocol,
      `handshake: unsupported protocol version ${String(parsed.data.protocolVersion)}`,
    );
  }
  if (parsed.data.credentials.kind !== "oauth") {
    throw new WireHandlerError(
      WireErrorCode.unsupportedCredentials,
      `handshake: unsupported credential kind '${parsed.data.credentials.kind}'`,
    );
  }
  state.credentials = { kind: "oauth", oauthToken: parsed.data.credentials.oauthToken };
  return {
    protocolVersion: WIRE_PROTOCOL_VERSION,
    server: RUNNER_SERVER_NAME,
    serverVersion: RUNNER_SERVER_VERSION,
    capabilities: ["health"],
  };
};
