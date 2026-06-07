import type { ParsedEvent } from "@prospero/shared";
import { assistantBlocksToEvent, usageToEstimate } from "./event-map.js";
import type { SdkToolDef } from "./tool-bridge.js";

export type LlmResponse = {
  stop_reason: string;
  content: Array<{ type: string; [k: string]: unknown }>;
  usage?: Record<string, number>;
};
export type LlmClient = {
  createMessage: (req: {
    model: string;
    /** The STABLE system prefix — cached (1h) by the SDK client. */
    system: string;
    /** The VOLATILE system suffix (digest/telos/etc.) — sent AFTER the cache
     * breakpoint so a changing digest never invalidates the cached prefix. */
    systemVolatile?: string;
    tools: SdkToolDef[];
    messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  }) => Promise<LlmResponse>;
};

export type RunTurnArgs = {
  client: LlmClient;
  model: string;
  system: string;
  /** Volatile system suffix forwarded to createMessage (uncached). */
  systemVolatile?: string;
  tools: SdkToolDef[];
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  runTool: (name: string, input: unknown) => Promise<string>;
  onEvent: (e: ParsedEvent) => void;
  maxRounds?: number;
};

// One full agentic turn: loop create -> tool_use -> tool_result until end_turn.
// Mutates `messages` (appends the assistant turn + tool_results) so the caller can
// keep it for follow-ups. Emits ParsedEvents the orchestrator already understands.
export const runAgenticTurn = async (args: RunTurnArgs): Promise<void> => {
  const max = args.maxRounds ?? 16;
  for (let round = 0; round < max; round++) {
    const res = await args.client.createMessage({
      model: args.model,
      system: args.system,
      ...(args.systemVolatile !== undefined ? { systemVolatile: args.systemVolatile } : {}),
      tools: args.tools,
      messages: args.messages,
    });

    const asst = assistantBlocksToEvent(res.content);
    if (asst !== null) args.onEvent(asst);
    args.messages.push({ role: "assistant", content: res.content });

    if (res.usage !== undefined) {
      args.onEvent({ kind: "turn-complete", usage: usageToEstimate(res.usage) });
    }

    const toolUses = res.content.filter((b) => b.type === "tool_use") as unknown as Array<{
      id: string;
      name: string;
      input: unknown;
    }>;
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) return;

    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const tu of toolUses) {
      let text: string;
      let isError = false;
      try {
        text = await args.runTool(tu.name, tu.input);
      } catch (e) {
        text = e instanceof Error ? e.message : String(e);
        isError = true;
      }
      args.onEvent({ kind: "tool-result", toolUseId: tu.id, content: text, isError });
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: text });
    }
    args.messages.push({ role: "user", content: toolResults });
  }
};
