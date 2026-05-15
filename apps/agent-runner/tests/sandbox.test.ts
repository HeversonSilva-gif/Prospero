import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareAgentSandbox } from "../src/sandbox.js";

describe("prepareAgentSandbox", () => {
  it("creates per-agent config and work directories", () => {
    const root = mkdtempSync(join(tmpdir(), "prospero-sbx-"));
    const sandbox = prepareAgentSandbox("agent_1", root);
    expect(existsSync(sandbox.configDir)).toBe(true);
    expect(existsSync(sandbox.workDir)).toBe(true);
    expect(sandbox.configDir).toContain("agent_1");
  });

  it("writes a settings.json that asks for filesystem tools", () => {
    const root = mkdtempSync(join(tmpdir(), "prospero-sbx-"));
    const sandbox = prepareAgentSandbox("agent_2", root);
    const settings = JSON.parse(readFileSync(join(sandbox.configDir, "settings.json"), "utf8")) as {
      permissions: { ask: string[]; allow: string[] };
    };
    expect(settings.permissions.ask).toContain("Bash");
    expect(settings.permissions.allow).toContain("mcp__dashboard__request_permission");
  });
});
