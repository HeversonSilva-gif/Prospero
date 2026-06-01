import { describe, it, expect } from "vitest";
import {
  executeCloudflareDeploy,
  parseDeploymentUrl,
  type WranglerRunner,
} from "./cloudflare-deploy-executor.js";
import type { ConnectionsRepository } from "./connections-repository.js";

const repoWith = (payload: Record<string, unknown> | null): ConnectionsRepository => ({
  save: () => undefined,
  load: () => (payload === null ? null : { payload, metadata: {} }),
  listMetadata: () => [],
  clear: () => undefined,
});

const okRunner =
  (capture: { args?: string[]; env?: Record<string, string>; cwd?: string }): WranglerRunner =>
  (args, env, cwd) => {
    capture.args = args;
    capture.env = env;
    capture.cwd = cwd;
    return Promise.resolve({
      stdout: "✨ Deployment complete! Take a peek over at https://abc.my-app.pages.dev",
      stderr: "",
      exitCode: 0,
    });
  };

const connected = { apiToken: "tok_secret", accountId: "acc_1" };

describe("parseDeploymentUrl", () => {
  it("extracts the pages.dev url", () => {
    expect(parseDeploymentUrl("blah https://abc.my-app.pages.dev done")).toBe(
      "https://abc.my-app.pages.dev",
    );
  });
  it("returns null when absent", () => {
    expect(parseDeploymentUrl("no url here")).toBeNull();
  });
});

describe("executeCloudflareDeploy", () => {
  it("runs wrangler with the token+account in env (not args) and returns the url", async () => {
    const cap: { args?: string[]; env?: Record<string, string>; cwd?: string } = {};
    const r = await executeCloudflareDeploy(
      { repo: repoWith(connected), runWrangler: okRunner(cap) },
      "c1",
      { projectPath: "/work/app", projectName: "my-app", mode: "production" },
    );
    expect(r).toEqual({ url: "https://abc.my-app.pages.dev" });
    expect(cap.env?.CLOUDFLARE_API_TOKEN).toBe("tok_secret");
    expect(cap.env?.CLOUDFLARE_ACCOUNT_ID).toBe("acc_1");
    expect(cap.cwd).toBe("/work/app");
    // the secret is NEVER in the argv
    expect(cap.args?.join(" ")).not.toContain("tok_secret");
    expect(cap.args).toContain("--project-name");
    expect(cap.args).toContain("my-app");
    expect(cap.args).toContain("main"); // production branch
  });

  it("uses the preview branch in preview mode", async () => {
    const cap: { args?: string[]; env?: Record<string, string>; cwd?: string } = {};
    await executeCloudflareDeploy({ repo: repoWith(connected), runWrangler: okRunner(cap) }, "c1", {
      projectPath: "/work/app",
      projectName: "my-app",
      mode: "preview",
    });
    expect(cap.args).toContain("preview");
    expect(cap.args).not.toContain("main");
  });

  it("throws a clear error when Cloudflare is not connected", async () => {
    await expect(
      executeCloudflareDeploy({ repo: repoWith(null), runWrangler: okRunner({}) }, "c1", {
        projectPath: "/work/app",
        projectName: "my-app",
        mode: "preview",
      }),
    ).rejects.toThrow(/não conectado/);
  });

  it("throws on a non-zero wrangler exit", async () => {
    const failRunner: WranglerRunner = () =>
      Promise.resolve({ stdout: "", stderr: "boom", exitCode: 1 });
    await expect(
      executeCloudflareDeploy({ repo: repoWith(connected), runWrangler: failRunner }, "c1", {
        projectPath: "/work/app",
        projectName: "my-app",
        mode: "preview",
      }),
    ).rejects.toThrow(/Falha no deploy/);
  });
});
