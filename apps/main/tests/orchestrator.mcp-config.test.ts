import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { writeMcpConfigFile } from "../src/orchestrator/mcp-config.js";

describe("writeMcpConfigFile", () => {
  it("writes a valid mcp.json with stdio server entry", () => {
    const path = writeMcpConfigFile("/fake/server.js", {
      CLAUDE_CODE_OAUTH_TOKEN: "t",
      AGENT_ID: "a",
      COMPANY_ID: "c",
    });
    type McpConfig = {
      mcpServers: {
        dashboard: {
          type: string;
          args: string[];
          env: Record<string, string>;
        };
      };
    };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as McpConfig;
    expect(parsed.mcpServers.dashboard.type).toBe("stdio");
    expect(parsed.mcpServers.dashboard.args).toContain("/fake/server.js");
    expect(parsed.mcpServers.dashboard.env["AGENT_ID"]).toBe("a");
    expect(parsed.mcpServers.dashboard.env["COMPANY_ID"]).toBe("c");
  });

  it("does NOT include CLAUDE_CODE_OAUTH_TOKEN in the mcp config file", () => {
    const path = writeMcpConfigFile("/fake/server.js", {
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_secret",
      AGENT_ID: "a",
      COMPANY_ID: "c",
    });
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain("sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_secret");
    expect(raw).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });
});
