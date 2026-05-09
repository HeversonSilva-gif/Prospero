import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnEnv } from "./env.js";

export const writeMcpConfigFile = (mcpServerJsPath: string, env: SpawnEnv): string => {
  const dir = mkdtempSync(join(tmpdir(), "da-mcp-"));
  const configPath = join(dir, "mcp.json");
  const config = {
    mcpServers: {
      dashboard: {
        type: "stdio",
        command: process.execPath,
        args: [mcpServerJsPath],
        env: {
          AGENT_ID: env.AGENT_ID,
          COMPANY_ID: env.COMPANY_ID,
          MCP_TOKEN: env.MCP_TOKEN,
        },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  return configPath;
};
