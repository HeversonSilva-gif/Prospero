import { describe, it, expect, vi } from "vitest";
import { handleCloudflareDeployEvent } from "./cloudflare-deploy-event.js";
import type { ConnectionsRepository } from "./connections-repository.js";
import type { WranglerRunner } from "./cloudflare-deploy-executor.js";

const repoWith = (payload: Record<string, unknown> | null): ConnectionsRepository => ({
  save: () => undefined,
  load: () => (payload === null ? null : { payload, metadata: {} }),
  listMetadata: () => [],
  clear: () => undefined,
});

const okRunner: WranglerRunner = () =>
  Promise.resolve({
    stdout: "https://x.my-app.pages.dev",
    stderr: "",
    exitCode: 0,
  });

const connected = { apiToken: "tok", accountId: "acc" };

describe("handleCloudflareDeployEvent", () => {
  it("writes an ok result and fires onProductionUrl for a production deploy", async () => {
    let result: unknown;
    const onProductionUrl = vi.fn();
    await handleCloudflareDeployEvent(
      {
        repo: repoWith(connected),
        runWrangler: okRunner,
        writeResult: (_id, r) => {
          result = r;
        },
        onProductionUrl,
      },
      "c1",
      { requestId: "r1", projectPath: "/app", projectName: "my-app", mode: "production" },
    );
    expect(result).toEqual({ ok: true, url: "https://x.my-app.pages.dev" });
    expect(onProductionUrl).toHaveBeenCalledWith("https://x.my-app.pages.dev");
  });

  it("does NOT fire onProductionUrl for a preview deploy", async () => {
    const onProductionUrl = vi.fn();
    await handleCloudflareDeployEvent(
      {
        repo: repoWith(connected),
        runWrangler: okRunner,
        writeResult: () => undefined,
        onProductionUrl,
      },
      "c1",
      { requestId: "r1", projectPath: "/app", projectName: "my-app", mode: "preview" },
    );
    expect(onProductionUrl).not.toHaveBeenCalled();
  });

  it("never throws — writes ok:false when not connected", async () => {
    let result: { ok: boolean } | undefined;
    await handleCloudflareDeployEvent(
      {
        repo: repoWith(null),
        runWrangler: okRunner,
        writeResult: (_id, r) => {
          result = r;
        },
      },
      "c1",
      { requestId: "r1", projectPath: "/app", projectName: "my-app", mode: "preview" },
    );
    expect(result?.ok).toBe(false);
  });
});
