import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareSandbox,
  seedSandboxCredentials,
  writeSandboxSettings,
} from "../src/orchestrator/adapters/claude-oauth-local/prepare-sandbox.js";
import { getAgentConfigDir, getAgentSandboxCwd } from "../src/orchestrator/util/paths.js";

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
    // Short layout (v0.1.38 MAX_PATH fix): <userData>/sbx/<slug>, cwd = .../c.
    expect(sb.agentConfigDir).toBe(getAgentConfigDir(tmp, "agent_1"));
    expect(sb.agentSandboxCwd).toBe(getAgentSandboxCwd(tmp, "agent_1"));
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

// The Anthropic OAuth refresh ROTATES the refresh token (the old one is revoked).
// When the agent's sandboxed claude refreshes, it writes a newer credential into
// its own CLAUDE_CONFIG_DIR/.credentials.json AND revokes the refresh token the
// host file still holds. Reseeding the (now-stale) host copy over that fresher
// sandbox file hands the agent a revoked refresh token → it 401s and can't
// recover. So a reseed must never DOWNGRADE: keep whichever credential expires
// later. This is the surgical half of the 2026-05-30 401-loop fix.
describe("seedSandboxCredentials — no-clobber on refresh-token rotation", () => {
  const writeCreds = (path: string, marker: string, expiresAt: number | null): void => {
    writeFileSync(
      path,
      JSON.stringify({
        claudeAiOauth: { accessToken: marker, refreshToken: `${marker}-refresh`, expiresAt },
      }),
    );
  };
  const seededMarker = (sandboxDir: string): string => {
    const parsed = JSON.parse(readFileSync(join(sandboxDir, ".credentials.json"), "utf8")) as {
      claudeAiOauth: { accessToken: string };
    };
    return parsed.claudeAiOauth.accessToken;
  };
  const withDirs = (fn: (hostCreds: string, sandboxDir: string) => void): void => {
    const hostDir = mkdtempSync(join(tmpdir(), "da-host-"));
    const sandboxDir = mkdtempSync(join(tmpdir(), "da-sbx-"));
    try {
      fn(join(hostDir, ".credentials.json"), sandboxDir);
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  };

  it("keeps the sandbox credential when it is fresher than the host", () => {
    withDirs((hostCreds, sandboxDir) => {
      writeCreds(hostCreds, "HOST", 1000);
      writeCreds(join(sandboxDir, ".credentials.json"), "SANDBOX", 2000); // refreshed, newer
      expect(seedSandboxCredentials(sandboxDir, hostCreds)).toBe(true);
      expect(seededMarker(sandboxDir)).toBe("SANDBOX"); // NOT clobbered
    });
  });

  it("overwrites the sandbox credential when the host is fresher", () => {
    withDirs((hostCreds, sandboxDir) => {
      writeCreds(hostCreds, "HOST", 2000); // host re-login / newer
      writeCreds(join(sandboxDir, ".credentials.json"), "SANDBOX", 1000);
      expect(seedSandboxCredentials(sandboxDir, hostCreds)).toBe(true);
      expect(seededMarker(sandboxDir)).toBe("HOST");
    });
  });

  it("seeds when the sandbox has no credential yet", () => {
    withDirs((hostCreds, sandboxDir) => {
      writeCreds(hostCreds, "HOST", 1000);
      expect(seedSandboxCredentials(sandboxDir, hostCreds)).toBe(true);
      expect(seededMarker(sandboxDir)).toBe("HOST");
    });
  });

  it("overwrites (safe default) when expiry is unknown on either side", () => {
    withDirs((hostCreds, sandboxDir) => {
      writeCreds(hostCreds, "HOST", null);
      writeCreds(join(sandboxDir, ".credentials.json"), "SANDBOX", 2000);
      expect(seedSandboxCredentials(sandboxDir, hostCreds)).toBe(true);
      expect(seededMarker(sandboxDir)).toBe("HOST");
    });
  });

  it("returns false (no seed) when the host file is missing", () => {
    withDirs((hostCreds, sandboxDir) => {
      // hostCreds path intentionally not written
      expect(seedSandboxCredentials(sandboxDir, hostCreds)).toBe(false);
      expect(existsSync(join(sandboxDir, ".credentials.json"))).toBe(false);
    });
  });
});
