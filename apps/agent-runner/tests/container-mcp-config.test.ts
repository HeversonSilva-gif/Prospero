import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpTripletArgs, writeContainerMcpConfig } from "../src/container-mcp-config.js";

describe("writeContainerMcpConfig", () => {
  it("writes an mcp.json pointing the dashboard server at the bridge", () => {
    const dir = mkdtempSync(join(tmpdir(), "prospero-mcpcfg-"));
    const path = writeContainerMcpConfig(dir, { bridgePath: "/app/mcp-bridge.js", port: 51234 });
    const config = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers: { dashboard: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(config.mcpServers.dashboard.args).toEqual(["/app/mcp-bridge.js"]);
    expect(config.mcpServers.dashboard.env["PROSPERO_MCP_PORT"]).toBe("51234");
  });
});

describe("mcpTripletArgs", () => {
  it("returns the mcp-config, strict, and permission-prompt flags", () => {
    expect(mcpTripletArgs("/cfg/mcp.json")).toEqual([
      "--mcp-config",
      "/cfg/mcp.json",
      "--strict-mcp-config",
      "--permission-prompt-tool",
      "mcp__dashboard__request_permission",
    ]);
  });
});
