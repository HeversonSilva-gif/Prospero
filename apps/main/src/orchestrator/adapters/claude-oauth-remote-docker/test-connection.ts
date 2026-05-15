import { spawn } from "node:child_process";
import {
  WireClient,
  WIRE_PROTOCOL_VERSION,
  type HandshakeResult,
  type HealthResult,
} from "@prospero/shared";
import { buildTransportCommand } from "./transport-command.js";
import { ChildProcessWireTransport } from "./child-transport.js";
import { resolveRemoteExecutionConfig } from "./connection-manager.js";

export type TestConnectionResult = { ok: boolean; message: string };

const TEST_TIMEOUT_MS = 15_000;

/**
 * Opens a throwaway wire connection (docker run / ssh, per the live Settings
 * config), performs handshake + health, then kills the child. Backs the Settings
 * "test connection" button. The OAuth token sent is the placeholder
 * "connection-test" — the runner only checks kind==="oauth" + non-empty at
 * handshake, so this exercises transport + handshake + health, not auth.
 *
 * Launcher glue: spawns Docker/SSH, so it is not unit-tested — verified by the
 * PR-E smoke checklist.
 */
export const testRemoteConnection = async (): Promise<TestConnectionResult> => {
  const { command, args } = buildTransportCommand(resolveRemoteExecutionConfig());
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const transport = new ChildProcessWireTransport(child);
  const client = new WireClient(transport);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("connection test timed out")), TEST_TIMEOUT_MS);
  });
  try {
    const handshake = await Promise.race([
      client.request<HandshakeResult>("handshake", {
        protocolVersion: WIRE_PROTOCOL_VERSION,
        client: "prospero-connection-test",
        clientVersion: "0.0.0",
        credentials: { kind: "oauth", oauthToken: "connection-test" },
      }),
      timeout,
    ]);
    if (handshake.protocolVersion !== WIRE_PROTOCOL_VERSION) {
      return {
        ok: false,
        message: `protocol mismatch: runner speaks ${String(handshake.protocolVersion)}`,
      };
    }
    const health = await Promise.race([client.request<HealthResult>("health"), timeout]);
    return {
      ok: health.ok,
      message: health.ok
        ? `runner healthy, ${String(health.activeAgents)} active agent(s)`
        : "runner reported unhealthy",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    child.kill();
  }
};
