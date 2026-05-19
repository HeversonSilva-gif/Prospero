import { describe, it, expect } from "vitest";
import { runSandboxedCommand, minimalVerificationEnv } from "./sandbox.js";

describe("sandbox", () => {
  it("minimalVerificationEnv excludes secrets", () => {
    const env = minimalVerificationEnv();
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
  });

  it("captures a zero exit code and stdout", async () => {
    const r = await runSandboxedCommand({
      command: `node -e "console.log('ok'); process.exit(0)"`,
      cwd: process.cwd(),
      timeoutMs: 15000,
      env: minimalVerificationEnv(),
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ok");
    expect(r.timedOut).toBe(false);
  });

  it("reports a non-zero exit code", async () => {
    const r = await runSandboxedCommand({
      command: `node -e "process.exit(3)"`,
      cwd: process.cwd(),
      timeoutMs: 15000,
      env: minimalVerificationEnv(),
    });
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it("flags a timeout", async () => {
    const r = await runSandboxedCommand({
      command: `node -e "setTimeout(() => {}, 8000)"`,
      cwd: process.cwd(),
      timeoutMs: 400,
      env: minimalVerificationEnv(),
    });
    expect(r.timedOut).toBe(true);
  });
});
