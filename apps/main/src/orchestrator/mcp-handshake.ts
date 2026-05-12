import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeMcpConfigFile } from "./mcp-config.js";
import type { SpawnEnv } from "./env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type HandshakeResult = {
  mcpConfigPath: string;
  mcpServerJsPath: string;
};

// Resolves the bundled MCP server entry path. tsup bundles src/index.ts → dist/index.js
// (single file, splitting:false), so at runtime __dirname resolves to dist/, not
// dist/orchestrator/. The MCP server is a separate entry → dist/mcp/server.js.
export const resolveMcpServerPath = (override?: string): string =>
  override ?? resolve(__dirname, "./mcp/server.js");

// Writes the per-spawn MCP config file pointing claude at our dashboard MCP server.
// Returns both paths so the adapter can pass mcpConfigPath to claude args and use
// mcpServerJsPath for logging/debugging.
export const setupMcpHandshake = (
  env: SpawnEnv,
  mcpServerJsPathOverride?: string,
): HandshakeResult => {
  const mcpServerJsPath = resolveMcpServerPath(mcpServerJsPathOverride);
  const mcpConfigPath = writeMcpConfigFile(mcpServerJsPath, env);
  return { mcpConfigPath, mcpServerJsPath };
};
