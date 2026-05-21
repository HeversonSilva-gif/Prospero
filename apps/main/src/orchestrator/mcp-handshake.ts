import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";
import { writeMcpConfigFile } from "./mcp-config.js";
import type { AnySpawnEnv } from "./env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type HandshakeResult = {
  mcpConfigPath: string;
  mcpServerJsPath: string;
};

// Resolves the bundled MCP server entry path. tsup bundles src/index.ts → dist/index.js
// (single file, splitting:false), so at runtime __dirname resolves to dist/, not
// dist/orchestrator/. The MCP server is a separate entry → dist/mcp/server.js.
//
// Packaged: the code lives inside app.asar (read-only), but claude spawns the MCP
// server as a SEPARATE node process (ELECTRON_RUN_AS_NODE) and Node's ESM loader
// cannot read a module from inside an asar — the server then provides zero tools
// and every dashboard call fails ("Available MCP tools: none"). electron-builder
// unpacks dist/mcp to app.asar.unpacked, so point the spawn at that real on-disk
// copy. In dev there is no app.asar segment, so this is a no-op.
export const resolveMcpServerPath = (override?: string): string => {
  if (override !== undefined) return override;
  // .cjs — the MCP server is built as CommonJS (see apps/main/tsup.config.ts) so
  // it can require() native modules when spawned as a plain Node process.
  const p = resolve(__dirname, "./mcp/server.cjs");
  const asarSeg = `${sep}app.asar${sep}`;
  return p.includes(asarSeg) ? p.replace(asarSeg, `${sep}app.asar.unpacked${sep}`) : p;
};

// Writes the per-spawn MCP config file pointing claude at our dashboard MCP server.
// Returns both paths so the adapter can pass mcpConfigPath to claude args and use
// mcpServerJsPath for logging/debugging.
export const setupMcpHandshake = (
  env: AnySpawnEnv,
  mcpServerJsPathOverride?: string,
): HandshakeResult => {
  const mcpServerJsPath = resolveMcpServerPath(mcpServerJsPathOverride);
  const mcpConfigPath = writeMcpConfigFile(mcpServerJsPath, env);
  return { mcpConfigPath, mcpServerJsPath };
};
