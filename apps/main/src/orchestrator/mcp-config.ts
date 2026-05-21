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
  const childEnv: Record<string, string> = {
    AGENT_ID: env.AGENT_ID,
    COMPANY_ID: env.COMPANY_ID,
    DB_PATH: env.DB_PATH,
    PERMISSIONS_DIR: env.PERMISSIONS_DIR,
    EVENTS_DIR: env.EVENTS_DIR,
  };
  // OS essentials so the spawned binary actually launches. Claude spawns the MCP
  // server with this env; if it does NOT merge its own environment, a child
  // launched without SystemRoot/PATH fails to start on Windows (and the MCP
  // handshake then yields "Available MCP tools: none"). These are non-secret.
  for (const key of ["SystemRoot", "windir", "SystemDrive", "PATH", "PATHEXT", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (value !== undefined) childEnv[key] = value;
  }
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
