// Spawned as a child by claude CLI. stderr is forwarded as JSONL events to parent.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { toolDefinitions, type ToolContext } from "./tools.js";
import { verifyMcpToken } from "./auth.js";

const expectedToken = process.env["MCP_TOKEN"];
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

const ctx: ToolContext = {
  agentId,
  companyId,
  emit: (event) => {
    process.stderr.write(JSON.stringify({ ...event, agentId, companyId }) + "\n");
  },
};

const server = new McpServer({ name: "dashboard", version: "0.0.1" });

for (const def of toolDefinitions) {
  server.registerTool(
    def.name,
    { description: def.description, inputSchema: def.inputSchema },
    async (input: unknown) => {
      // stdio MCP can't carry custom auth headers, so we validate the env presence as a soft guard.
      // Future hardening: rotate MCP_TOKEN per-call via a request_id challenge.
      verifyMcpToken(expectedToken, expectedToken);
      const result = await def.run(input as never, ctx);
      return { content: [{ type: "text" as const, text: result }] };
    },
  );
}

const transport = new StdioServerTransport();
void server.connect(transport);
