import type { ConnectionsRepository } from "./connections-repository.js";
import { executeCloudflareDeploy, type WranglerRunner } from "./cloudflare-deploy-executor.js";

// Payload carried by the `cloudflare.deploy` side-channel event the deploy_app MCP tool
// emits (in the MCP child) after a preview deploy or an approved production deploy.
export type CloudflareDeployEventPayload = {
  requestId: string;
  projectPath: string;
  projectName: string;
  mode: "preview" | "production";
};

// Result the tool polls for (keyed by requestId) so it can return the live URL — or a
// clear error — to the agent in the same turn.
export type CloudflareDeployEventResult = { ok: true; url: string } | { ok: false; error: string };

// MAIN-process reaction to a `cloudflare.deploy` event. Only MAIN holds the safeStorage
// cipher to decrypt the company's Cloudflare token, so the Wrangler run happens here (not
// in the MCP child). Never throws: a failure writes an `ok: false` result so the waiting
// tool resolves. On a production deploy, `onProductionUrl` lets MAIN persist the live URL.
export const handleCloudflareDeployEvent = async (
  deps: {
    repo: ConnectionsRepository;
    runWrangler: WranglerRunner;
    writeResult: (requestId: string, result: CloudflareDeployEventResult) => void;
    onProductionUrl?: (url: string) => void;
  },
  companyId: string,
  payload: CloudflareDeployEventPayload,
): Promise<void> => {
  try {
    const r = await executeCloudflareDeploy(deps, companyId, {
      projectPath: payload.projectPath,
      projectName: payload.projectName,
      mode: payload.mode,
    });
    if (payload.mode === "production") deps.onProductionUrl?.(r.url);
    deps.writeResult(payload.requestId, { ok: true, url: r.url });
  } catch (e) {
    deps.writeResult(payload.requestId, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
