import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnySpawnEnv } from "./env.js";

// In Electron's main process, `process.execPath` points to electron.exe, not node.
// Spawning that to run a plain JS file launches a GUI app shell and hangs the MCP
// handshake — claude then waits forever for the MCP server to initialize and never
// emits any output. ELECTRON_RUN_AS_NODE=1 makes the Electron binary behave as a
// regular Node runtime for that child process, which is the documented workaround.
const isElectronBinary = /electron(\.exe)?$/i.test(process.execPath);

export const writeMcpConfigFile = (mcpServerJsPath: string, env: AnySpawnEnv): string => {
  const dir = mkdtempSync(join(tmpdir(), "da-mcp-"));
  const configPath = join(dir, "mcp.json");
  // Start from the full parent environment, then layer the MCP-specific vars on
  // top. A direct spawn of the server with the full env loads it fine, while a
  // minimal env yielded "Available MCP tools: none" — so we no longer assume
  // claude merges its own environment. The OAuth token is NOT in process.env
  // (it lives in safeStorage and is injected only into the claude spawn), so
  // this does not leak it into the on-disk mcp.json.
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  childEnv.AGENT_ID = env.AGENT_ID;
  childEnv.COMPANY_ID = env.COMPANY_ID;
  childEnv.DB_PATH = env.DB_PATH;
  childEnv.PERMISSIONS_DIR = env.PERMISSIONS_DIR;
  childEnv.EVENTS_DIR = env.EVENTS_DIR;
  if (isElectronBinary) {
    childEnv.ELECTRON_RUN_AS_NODE = "1";
  }
  const config = {
    mcpServers: {
      dashboard: {
        type: "stdio",
        command: process.execPath,
        args: [mcpServerJsPath],
        env: childEnv,
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  return configPath;
};
