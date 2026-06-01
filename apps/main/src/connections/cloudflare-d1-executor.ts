import type { ConnectionsRepository } from "./connections-repository.js";
import type { WranglerRunner } from "./cloudflare-deploy-executor.js";

// MAIN-process action behind the provision_database tool. Runs a CONSTRAINED Wrangler D1
// subcommand (create or migrate — never delete) with the company's token in the subprocess
// env only. The args are built HERE from a closed `command` enum, so the agent can never
// inject an arbitrary/destructive wrangler invocation. Runner injected for unit tests.
export type D1Command = "create" | "migrate";

export const executeCloudflareD1 = async (
  deps: { repo: ConnectionsRepository; runWrangler: WranglerRunner },
  companyId: string,
  input: { projectPath: string; databaseName: string; command: D1Command },
): Promise<{ output: string }> => {
  const conn = deps.repo.load(companyId, "cloudflare");
  const token =
    conn !== null && typeof conn.payload.apiToken === "string" ? conn.payload.apiToken : null;
  const accountId =
    conn !== null && typeof conn.payload.accountId === "string" ? conn.payload.accountId : null;
  if (token === null || accountId === null) {
    throw new Error("Cloudflare não conectado para esta empresa (conecte em Ajustes › Conta).");
  }
  const args =
    input.command === "create"
      ? ["d1", "create", input.databaseName]
      : ["d1", "migrations", "apply", input.databaseName, "--remote"];
  const { stdout, stderr, exitCode } = await deps.runWrangler(
    args,
    { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId },
    input.projectPath,
  );
  if (exitCode !== 0) {
    throw new Error(
      `Falha no D1 (wrangler saiu ${String(exitCode)}): ${(stderr || stdout).slice(0, 500)}`,
    );
  }
  return { output: stdout.slice(0, 4000) };
};
