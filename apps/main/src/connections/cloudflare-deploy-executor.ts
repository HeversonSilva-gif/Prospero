import type { ConnectionsRepository } from "./connections-repository.js";

// MAIN-process action behind the deploy_app tool. Runs Wrangler as a child process to
// deploy a Cloudflare Pages app, with the company's API token + account id injected into
// the SUBPROCESS ENV ONLY — never into the agent's shell, the args, the approval payload,
// or any log. The runner is injected so this is unit-testable without spawning Wrangler.
export type WranglerRunner = (
  args: string[],
  env: Record<string, string>,
  cwd: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

// Pure: pull the deployed *.pages.dev URL out of Wrangler's stdout
// (e.g. "✨ Deployment complete! Take a peek over at https://abc.my-app.pages.dev").
export const parseDeploymentUrl = (stdout: string): string | null => {
  const m = /https:\/\/[a-z0-9.-]+\.pages\.dev[^\s)]*/i.exec(stdout);
  return m !== null ? m[0] : null;
};

export const executeCloudflareDeploy = async (
  deps: { repo: ConnectionsRepository; runWrangler: WranglerRunner },
  companyId: string,
  input: { projectPath: string; projectName: string; mode: "preview" | "production" },
): Promise<{ url: string }> => {
  const conn = deps.repo.load(companyId, "cloudflare");
  const token =
    conn !== null && typeof conn.payload.apiToken === "string" ? conn.payload.apiToken : null;
  const accountId =
    conn !== null && typeof conn.payload.accountId === "string" ? conn.payload.accountId : null;
  if (token === null || accountId === null) {
    throw new Error("Cloudflare não conectado para esta empresa (conecte em Ajustes › Conta).");
  }
  // Pages: the production branch deploys to <project>.pages.dev; any other branch gets
  // an unlisted <hash>.<project>.pages.dev preview URL.
  const branch = input.mode === "production" ? "main" : "preview";
  const { stdout, stderr, exitCode } = await deps.runWrangler(
    ["pages", "deploy", input.projectPath, "--project-name", input.projectName, "--branch", branch],
    { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId },
    input.projectPath,
  );
  if (exitCode !== 0) {
    throw new Error(
      `Falha no deploy (wrangler saiu ${String(exitCode)}): ${(stderr || stdout).slice(0, 500)}`,
    );
  }
  const url = parseDeploymentUrl(stdout);
  if (url === null) {
    throw new Error("Deploy concluído, mas não consegui ler a URL publicada.");
  }
  return { url };
};
