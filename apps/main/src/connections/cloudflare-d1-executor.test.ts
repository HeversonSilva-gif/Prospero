import { describe, it, expect } from "vitest";
import { executeCloudflareD1 } from "./cloudflare-d1-executor.js";
import type { ConnectionsRepository } from "./connections-repository.js";
import type { WranglerRunner } from "./cloudflare-deploy-executor.js";

const repoWith = (payload: Record<string, unknown> | null): ConnectionsRepository => ({
  save: () => undefined,
  load: () => (payload === null ? null : { payload, metadata: {} }),
  listMetadata: () => [],
  clear: () => undefined,
});

const okRunner =
  (cap: { args?: string[]; env?: Record<string, string> }): WranglerRunner =>
  (args, env) => {
    cap.args = args;
    cap.env = env;
    return Promise.resolve({ stdout: "database_id = abc-123", stderr: "", exitCode: 0 });
  };

const connected = { apiToken: "tok", accountId: "acc" };

describe("executeCloudflareD1", () => {
  it("runs `d1 create` with the token in env and returns the output", async () => {
    const cap: { args?: string[]; env?: Record<string, string> } = {};
    const r = await executeCloudflareD1(
      { repo: repoWith(connected), runWrangler: okRunner(cap) },
      "c1",
      { projectPath: "/app", databaseName: "my-db", command: "create" },
    );
    expect(cap.args).toEqual(["d1", "create", "my-db"]);
    expect(cap.env?.CLOUDFLARE_API_TOKEN).toBe("tok");
    expect(r.output).toContain("database_id");
  });

  it("runs `d1 migrations apply --remote` for the migrate command", async () => {
    const cap: { args?: string[]; env?: Record<string, string> } = {};
    await executeCloudflareD1({ repo: repoWith(connected), runWrangler: okRunner(cap) }, "c1", {
      projectPath: "/app",
      databaseName: "my-db",
      command: "migrate",
    });
    expect(cap.args).toEqual(["d1", "migrations", "apply", "my-db", "--remote"]);
  });

  it("throws when Cloudflare is not connected", async () => {
    await expect(
      executeCloudflareD1({ repo: repoWith(null), runWrangler: okRunner({}) }, "c1", {
        projectPath: "/app",
        databaseName: "my-db",
        command: "create",
      }),
    ).rejects.toThrow(/não conectado/);
  });

  it("throws on a non-zero wrangler exit", async () => {
    const fail: WranglerRunner = () => Promise.resolve({ stdout: "", stderr: "boom", exitCode: 1 });
    await expect(
      executeCloudflareD1({ repo: repoWith(connected), runWrangler: fail }, "c1", {
        projectPath: "/app",
        databaseName: "my-db",
        command: "create",
      }),
    ).rejects.toThrow(/Falha no D1/);
  });
});
