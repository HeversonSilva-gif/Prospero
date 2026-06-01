import type { ConnectionsRepository } from "./connections-repository.js";
import type { WranglerRunner } from "./cloudflare-deploy-executor.js";
import { executeCloudflareD1, type D1Command } from "./cloudflare-d1-executor.js";

// Payload carried by the `cloudflare.d1` side-channel event the provision_database MCP
// tool emits after its tool call passes the approval gate.
export type CloudflareD1EventPayload = {
  requestId: string;
  projectPath: string;
  databaseName: string;
  command: D1Command;
};

export type CloudflareD1EventResult = { ok: true; output: string } | { ok: false; error: string };

// MAIN-process reaction to a `cloudflare.d1` event. Only MAIN holds the cipher to decrypt
// the token, so Wrangler runs here. Never throws: a failure writes an `ok: false` result.
export const handleCloudflareD1Event = async (
  deps: {
    repo: ConnectionsRepository;
    runWrangler: WranglerRunner;
    writeResult: (requestId: string, result: CloudflareD1EventResult) => void;
  },
  companyId: string,
  payload: CloudflareD1EventPayload,
): Promise<void> => {
  try {
    const r = await executeCloudflareD1(deps, companyId, {
      projectPath: payload.projectPath,
      databaseName: payload.databaseName,
      command: payload.command,
    });
    deps.writeResult(payload.requestId, { ok: true, output: r.output });
  } catch (e) {
    deps.writeResult(payload.requestId, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
