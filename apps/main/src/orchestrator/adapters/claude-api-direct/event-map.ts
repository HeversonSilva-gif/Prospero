import type { AssistantContentBlock, ParsedEvent, UsageEstimate } from "@prospero/shared";

type SdkBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: string; [k: string]: unknown };

export const assistantBlocksToEvent = (blocks: SdkBlock[]): ParsedEvent | null => {
  const out: AssistantContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof (b as { text?: unknown }).text === "string") {
      out.push({ kind: "text", text: (b as { text: string }).text });
    } else if (b.type === "tool_use") {
      const tb = b as { id: string; name: string; input: unknown };
      out.push({ kind: "tool-use", id: tb.id, name: tb.name, input: tb.input ?? {} });
    }
  }
  if (out.length === 0) return null;
  return { kind: "assistant-message", blocks: out };
};

export const usageToEstimate = (u: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): UsageEstimate => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cache_creation: u.cache_creation_input_tokens ?? 0,
  cache_read: u.cache_read_input_tokens ?? 0,
});
