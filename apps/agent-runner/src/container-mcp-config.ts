import { writeFileSync } from "node:fs";
import { join } from "node:path";

export type McpConfigOptions = {
  /** Absolute path to the bundled mcp-bridge.js inside the container. */
  bridgePath: string;
  /** The loopback port the bridge should connect to. */
  port: number;
};

/**
 * Writes the container `mcp.json` that makes claude launch the mcp-bridge as
 * its `dashboard` MCP server. The bridge connects back to the runner on `port`.
 * Returns the path of the written file.
 */
export const writeContainerMcpConfig = (configDir: string, opts: McpConfigOptions): string => {
  const path = join(configDir, "mcp.json");
  const config = {
    mcpServers: {
      dashboard: {
        type: "stdio",
        command: process.execPath,
        args: [opts.bridgePath],
        env: { PROSPERO_MCP_PORT: String(opts.port) },
      },
    },
  };
  writeFileSync(path, JSON.stringify(config), "utf8");
  return path;
};

/**
 * The MCP-flag triplet the runner appends to the host-built `claude` argv:
 * point claude at our mcp.json, ignore any other MCP servers, and route
 * permission prompts through the dashboard tool.
 */
export const mcpTripletArgs = (mcpConfigPath: string): string[] => [
  "--mcp-config",
  mcpConfigPath,
  "--strict-mcp-config",
  "--permission-prompt-tool",
  "mcp__dashboard__request_permission",
];
