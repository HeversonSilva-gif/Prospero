import { zodToJsonSchema } from "zod-to-json-schema";
import { toolDefinitions, type ToolContext } from "../../../mcp/tools.js";
import { goalsToolDefinitions } from "../../../mcp/tools-goals.js";
import { orgToolDefinitions } from "../../../mcp/tools-org.js";
import { genesisToolDefinitions } from "../../../mcp/tools-genesis.js";
import { issuesToolDefinitions } from "../../../mcp/tools-issues.js";
import { memoryToolDefinitions } from "../../../mcp/tools-memory.js";
import { isaToolDefinitions } from "../../../mcp/tools-isa.js";
import { projectContextToolDefinitions } from "../../../mcp/tools-project-context.js";
import { visibleToolNames } from "../../../mcp/tool-visibility.js";
import { processToolResult } from "../../../tokenjuice/index.js";

const ALL_DEFS = [
  ...toolDefinitions,
  ...goalsToolDefinitions,
  ...orgToolDefinitions,
  ...genesisToolDefinitions,
  ...issuesToolDefinitions,
  ...memoryToolDefinitions,
  ...isaToolDefinitions,
  ...projectContextToolDefinitions,
];

const byName = new Map(ALL_DEFS.map((d) => [d.name, d]));

export type SdkToolDef = {
  name: string;
  description: string;
  input_schema: { type: "object"; [k: string]: unknown };
};

// Convert a tool's Zod schema to the JSON Schema the Anthropic API expects.
// The API validates tool input_schema against JSON Schema **draft 2020-12**. We must
// NOT use zod-to-json-schema's `openApi3` target: it emits the OpenAPI-3.0 dialect —
// e.g. `exclusiveMinimum: true` as a BOOLEAN for `.positive()`/`.gt()` — which draft
// 2020-12 rejects with a 400 ("input_schema: JSON schema is invalid"), the v0.2.18
// CEO outage. The default (draft-07) emits NUMERIC `exclusiveMinimum`, matching what
// the MCP server already sends successfully for the CLI agents. `$refStrategy:"none"`
// inlines everything (no $ref/$defs), and we drop `$schema` so the API interprets the
// schema as 2020-12 rather than seeing a mis-declared draft-07 meta-schema URL.
const toApiInputSchema = (schema: unknown): { type: "object"; [k: string]: unknown } => {
  // `as never`: some defs use ZodEffects (refine/transform) and zodToJsonSchema's
  // param type is deep/recursive — a precise cast triggers TS2589.
  const json = zodToJsonSchema(schema as never, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete json["$schema"];
  return json as { type: "object"; [k: string]: unknown };
};

export const buildSdkTools = (
  capabilities: string[],
  policy: { canHire?: boolean; canAssign?: boolean } = {},
): SdkToolDef[] => {
  // Honor the agent's real run policy (the adapter passes agent.canHire/canAssign)
  // so e.g. a CEO with canHire=false doesn't get hire/fire tools. Defaults to true
  // for back-compat with callers that don't pass a policy.
  const visible = visibleToolNames(
    ALL_DEFS.map((d) => d.name),
    {
      capabilities,
      canHire: policy.canHire ?? true,
      canAssign: policy.canAssign ?? true,
    },
  );
  return ALL_DEFS.filter((d) => visible.has(d.name)).map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: toApiInputSchema(d.inputSchema),
  }));
};

export const runTool = async (name: string, input: unknown, ctx: ToolContext): Promise<string> => {
  const def = byName.get(name);
  if (def === undefined) throw new Error(`unknown tool: ${name}`);
  const result = await def.run(input as never, ctx);
  return processToolResult({ toolName: name, result, ctx });
};
