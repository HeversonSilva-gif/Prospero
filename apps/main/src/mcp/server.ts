// Spawned as a child by claude CLI. Side-channel events are emitted by writing
// JSON files to EVENTS_DIR, where the orchestrator's chokidar watcher picks
// them up. Stderr forwarding from this MCP child through claude is unreliable
// on Windows (events vanish), so file-based delivery is the reliable channel.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { safeAppend } from "../logging/safe-log.js";

// Self-log to a file. When claude spawns this MCP server, its stdout/stderr are
// consumed by claude (the host only sees "Available MCP tools: none"), so this
// file is the only window into how far the server actually gets. Path is derived
// straight from DB_PATH so it works before any other setup. Routed through
// safeAppend so the log redacts secrets + the user's home path and stays bounded
// (this file is bundled into the CJS child, so the helper resolves fine here).
const slog = (msg: string): void => {
  const p = process.env["DB_PATH"];
  if (p !== undefined) {
    safeAppend(join(dirname(p), "mcp-server.log"), `[${new Date().toISOString()}] ${msg}`);
  }
};
slog(
  `starting: node=${process.version} execPath=${process.execPath} argv=${process.argv.join(" ")}`,
);
process.on("uncaughtException", (e: unknown) => {
  slog(`uncaughtException: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
});
process.on("unhandledRejection", (e: unknown) => {
  slog(`unhandledRejection: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
});
import { toolDefinitions, type ToolContext } from "./tools.js";
import { goalsToolDefinitions } from "./tools-goals.js";
import { orgToolDefinitions } from "./tools-org.js";
import { issuesToolDefinitions } from "./tools-issues.js";
import { memoryToolDefinitions } from "./tools-memory.js";
import { isaToolDefinitions } from "./tools-isa.js";
import { projectContextToolDefinitions } from "./tools-project-context.js";
import { genesisToolDefinitions } from "./tools-genesis.js";
import { visibleToolNames } from "./tool-visibility.js";
import { processToolResult } from "../tokenjuice/index.js";

const agentId = process.env["AGENT_ID"];
const companyId = process.env["COMPANY_ID"];

if (agentId === undefined || companyId === undefined) {
  process.stderr.write(
    JSON.stringify({
      kind: "mcp.fatal",
      error: "MCP server requires AGENT_ID and COMPANY_ID env vars",
    }) + "\n",
  );
  process.exit(1);
}

const dbPath = process.env["DB_PATH"];
const permissionsDir = process.env["PERMISSIONS_DIR"];
const eventsDir = process.env["EVENTS_DIR"];
if (dbPath === undefined || permissionsDir === undefined || eventsDir === undefined) {
  process.stderr.write(
    JSON.stringify({
      kind: "mcp.fatal",
      error: "MCP server requires DB_PATH, PERMISSIONS_DIR, and EVENTS_DIR env vars",
    }) + "\n",
  );
  process.exit(1);
}

slog(`env ok; opening db at ${dbPath}`);
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
slog(`db opened`);

const ctx: ToolContext = {
  agentId,
  companyId,
  db,
  permissionsDir,
  userDataDir: dirname(dbPath),
  emit: (event) => {
    const filename = `${Date.now()}_${randomUUID()}.json`;
    try {
      writeFileSync(
        join(eventsDir, filename),
        JSON.stringify({ ...event, agentId, companyId }),
        "utf8",
      );
    } catch (e) {
      // best effort; surface via stderr as fallback (orchestrator may catch it)
      process.stderr.write(`[mcp/emit] failed to write event file: ${(e as Error).message}\n`);
    }
  },
};

const server = new McpServer({ name: "dashboard", version: "0.0.1" });

// MCP SDK 1.x + Zod 3.25 trigger excessively-deep type instantiation in `registerTool`'s
// generic inference. Runtime is correct (covered by tests/mcp.tools.test.ts and integration).
// We cast the server reference to a structurally compatible shape to break the deep inference.
type RegisterTool = (
  name: string,
  config: { description: string; inputSchema: unknown },
  handler: (input: unknown) => Promise<{ content: { type: "text"; text: string }[] }>,
) => void;

const register = (server.registerTool as unknown as RegisterTool).bind(server);

const allToolDefinitions = [
  ...toolDefinitions,
  ...goalsToolDefinitions,
  ...orgToolDefinitions,
  ...genesisToolDefinitions,
  ...issuesToolDefinitions,
  ...memoryToolDefinitions,
  ...isaToolDefinitions,
  ...projectContextToolDefinitions,
];

// Advertise only the tools THIS agent can reach, instead of all ~60, so a worker doesn't
// pay to cache the CEO's planning/connector schemas on every turn (v0.2.10 token audit,
// prompt C1). FAIL-OPEN: if the agent row can't be read/parsed, register everything — the
// filter is a cache optimization, never the security boundary (--allowedTools is), so a
// resolution failure must never strand an agent without tools.
let registerDefs = allToolDefinitions;
try {
  const row = db
    .prepare("SELECT capabilities_json, can_hire, can_assign FROM agents WHERE id = ?")
    .get(agentId) as
    | { capabilities_json: string; can_hire: number; can_assign: number }
    | undefined;
  if (row !== undefined) {
    const capabilities = JSON.parse(row.capabilities_json) as string[];
    const visible = visibleToolNames(
      allToolDefinitions.map((d) => d.name),
      { capabilities, canHire: row.can_hire === 1, canAssign: row.can_assign === 1 },
    );
    registerDefs = allToolDefinitions.filter((d) => visible.has(d.name));
    slog(
      `tool visibility: registering ${String(registerDefs.length)}/${String(allToolDefinitions.length)} for caps=[${capabilities.join(",")}]`,
    );
  } else {
    slog(`tool visibility: agent ${agentId} not found; registering all (fail-open)`);
  }
} catch (e) {
  registerDefs = allToolDefinitions;
  slog(`tool visibility resolution failed (${(e as Error).message}); registering all (fail-open)`);
}

for (const def of registerDefs) {
  register(
    def.name,
    { description: def.description, inputSchema: def.inputSchema.shape },
    async (input: unknown) => {
      // stdio MCP is a private parent-child pipe — no other process can connect, so no
      // application-level auth token is meaningful. AGENT_ID/COMPANY_ID still come from
      // env to scope the tool context. If we ever switch transport to HTTP/WS, revisit.
      const result = await def.run(input as never, ctx);
      const text = processToolResult({ toolName: def.name, result, ctx });
      return { content: [{ type: "text" as const, text }] };
    },
  );
}

slog(`registered ${registerDefs.length} tools; connecting transport`);
const transport = new StdioServerTransport();
void server.connect(transport).then(
  () => slog(`transport connected`),
  (e: unknown) =>
    slog(`connect failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`),
);
