import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareSandbox,
  seedSandboxCredentials,
  writeSandboxSettings,
} from "../src/orchestrator/adapters/claude-oauth-local/prepare-sandbox.js";

describe("prepareSandbox", () => {
  it("returns ephemeral dirs when userDataDir is undefined", () => {
    const sb = prepareSandbox("agent_1", undefined);
    expect(sb.isEphemeralConfigDir).toBe(true);
    expect(existsSync(sb.agentConfigDir)).toBe(true);
    expect(existsSync(sb.agentSandboxCwd)).toBe(true);
    rmSync(sb.agentConfigDir, { recursive: true, force: true });
    rmSync(sb.agentSandboxCwd, { recursive: true, force: true });
  });

  it("returns persistent dirs under userDataDir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "da-test-userdata-"));
    const sb = prepareSandbox("agent_1", tmp);
    expect(sb.isEphemeralConfigDir).toBe(false);
    expect(sb.agentConfigDir).toContain("agent_1");
    expect(sb.agentSandboxCwd).toContain("agent_1");
    expect(existsSync(sb.agentConfigDir)).toBe(true);
    expect(existsSync(sb.agentSandboxCwd)).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("writeSandboxSettings", () => {
  it("writes settings.json with ask and allow lists", () => {
    const dir = mkdtempSync(join(tmpdir(), "da-test-cfg-"));
    writeSandboxSettings(dir);
    const settingsPath = join(dir, "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      permissions: { ask: string[]; allow: string[] };
    };
    expect(parsed.permissions.ask).toContain("Bash");
    expect(parsed.permissions.ask).toContain("Read");
    expect(parsed.permissions.allow).toContain("mcp__dashboard__request_permission");
    expect(parsed.permissions.allow).toContain("mcp__dashboard__list_agents");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("seedSandboxCredentials", () => {
  it("does not throw when host credentials are absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "da-test-cfg-"));
    expect(() => seedSandboxCredentials(dir)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
