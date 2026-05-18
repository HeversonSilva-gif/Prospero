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
import { toolDefinitions, type ToolContext } from "./tools.js";
import { goalsToolDefinitions } from "./tools-goals.js";
import { orgToolDefinitions } from "./tools-org.js";
import { issuesToolDefinitions } from "./tools-issues.js";
import { memoryToolDefinitions } from "./tools-memory.js";

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

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

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
  ...issuesToolDefinitions,
  ...memoryToolDefinitions,
];

for (const def of allToolDefinitions) {
  register(
    def.name,
    { description: def.description, inputSchema: def.inputSchema.shape },
    async (input: unknown) => {
      // stdio MCP is a private parent-child pipe — no other process can connect, so no
      // application-level auth token is meaningful. AGENT_ID/COMPANY_ID still come from
      // env to scope the tool context. If we ever switch transport to HTTP/WS, revisit.
      const result = await def.run(input as never, ctx);
      return { content: [{ type: "text" as const, text: result }] };
    },
  );
}

const transport = new StdioServerTransport();
void server.connect(transport);
