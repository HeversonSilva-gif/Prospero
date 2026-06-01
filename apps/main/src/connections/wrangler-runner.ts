import crossSpawn from "cross-spawn";
import type { WranglerRunner } from "./cloudflare-deploy-executor.js";

// The real Wrangler invocation: spawn the project-local Wrangler via `npx wrangler …`
// in the app's directory, with the Cloudflare credential vars merged into the env. Not
// unit-tested directly (it spawns a real process) — mirrors derivation's defaultRunProcess;
// the pure executor + URL parser carry the test coverage. The token is in the child env,
// never echoed. cross-spawn for Windows-safe `npx` resolution.
export const defaultWranglerRunner: WranglerRunner = (args, env, cwd) =>
  new Promise((resolve) => {
    const child = crossSpawn("npx", ["wrangler", ...args], {
      cwd,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e: Error) =>
      resolve({ stdout, stderr: `${stderr}${e.message}`, exitCode: 1 }),
    );
    child.on("close", (code: number | null) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
