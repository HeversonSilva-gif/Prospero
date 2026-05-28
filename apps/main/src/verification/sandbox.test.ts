import { describe, it, expect, vi, afterEach } from "vitest";
import { runSandboxedCommand, minimalVerificationEnv } from "./sandbox.js";

describe("sandbox", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("minimalVerificationEnv excludes secrets", () => {
    const env = minimalVerificationEnv();
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
  });

  it("minimalVerificationEnv includes PATH when set", () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    const env = minimalVerificationEnv();
    expect(env["PATH"]).toBe("/usr/bin:/bin");
  });

  it("minimalVerificationEnv includes POSIX essentials when set", () => {
    vi.stubEnv("HOME", "/home/user");
    vi.stubEnv("USER", "user");
    vi.stubEnv("LOGNAME", "user");
    vi.stubEnv("TMPDIR", "/tmp");
    const env = minimalVerificationEnv();
    expect(env["HOME"]).toBe("/home/user");
    expect(env["USER"]).toBe("user");
    expect(env["LOGNAME"]).toBe("user");
    expect(env["TMPDIR"]).toBe("/tmp");
  });

  it("minimalVerificationEnv includes Windows essentials when set", () => {
    vi.stubEnv("SystemRoot", "C:\\Windows");
    vi.stubEnv("PATHEXT", ".COM;.EXE;.BAT");
    const env = minimalVerificationEnv();
    expect(env["SystemRoot"]).toBe("C:\\Windows");
    expect(env["PATHEXT"]).toBe(".COM;.EXE;.BAT");
  });

  it("minimalVerificationEnv omits POSIX keys when not in environment", () => {
    // Temporarily remove POSIX vars to verify omission (not all runners have all vars)
    vi.stubEnv("HOME", undefined);
    vi.stubEnv("TMPDIR", undefined);
    const env = minimalVerificationEnv();
    expect(env["HOME"]).toBeUndefined();
    expect(env["TMPDIR"]).toBeUndefined();
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
      timeoutMs: 1000,
      env: minimalVerificationEnv(),
    });
    expect(r.timedOut).toBe(true);
  });
});
