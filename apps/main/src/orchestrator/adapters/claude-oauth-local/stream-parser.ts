// Parser for `claude -p --output-format stream-json --verbose`.
//
// Real shape (verified against claude 2.1.138):
//   - {"type":"system","subtype":"init", session_id, ...}            → session-init
//   - {"type":"system","subtype":"hook_*", ...}                      → ignored
//   - {"type":"assistant", message:{content:[{type:"text"|"tool_use"...}]}} → assistant-message
//   - {"type":"user", message:{content:[{type:"tool_result", tool_use_id, content}]}} → tool-result
//   - {"type":"rate_limit_event", ...}                               → ignored
//   - {"type":"result", subtype, ...}                                → turn-complete
//
// Older / partial-message stream events (--include-partial-messages):
//   - {"type":"stream_event", event:{type:"content_block_*"|"message_stop", ...}}
// Still parsed for forward compatibility.

import type { AssistantContentBlock, ParsedEvent, UsageEstimate } from "@prospero/shared";

export type { AssistantContentBlock, ParsedEvent };

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object";

const toAssistantBlocks = (content: unknown): AssistantContentBlock[] => {
  if (!Array.isArray(content)) return [];
  const blocks: AssistantContentBlock[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    const t = block["type"];
    if (t === "text" && typeof block["text"] === "string") {
      blocks.push({ kind: "text", text: block["text"] });
    } else if (
      t === "tool_use" &&
      typeof block["id"] === "string" &&
      typeof block["name"] === "string"
    ) {
      blocks.push({
        kind: "tool-use",
        id: block["id"],
        name: block["name"],
        input: block["input"] ?? {},
      });
    }
  }
  return blocks;
};

const safeReadUsage = (raw: unknown): UsageEstimate | undefined => {
  if (!isObject(raw)) return undefined;
  const n = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  const result: UsageEstimate = {
    input: n(raw["input_tokens"]),
    output: n(raw["output_tokens"]),
    cache_creation: n(raw["cache_creation_input_tokens"]),
    cache_read: n(raw["cache_read_input_tokens"]),
  };
  const total = result.input + result.output + result.cache_creation + result.cache_read;
  return total > 0 ? result : undefined;
};

const readModel = (data: Record<string, unknown>): string | undefined => {
  if (typeof data["model"] === "string") return data["model"];
  if (isObject(data["message"]) && typeof data["message"]["model"] === "string") {
    return data["message"]["model"];
  }
  return undefined;
};

const extractToolResultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (isObject(c) && typeof c["text"] === "string") parts.push(c["text"]);
    }
    return parts.join("\n");
  }
  return "";
};

export const parseStreamLine = (line: string): ParsedEvent | null => {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  const data = safeParse(trimmed);
  if (!isObject(data)) return null;

  // system events
  if (data["type"] === "system") {
    if (data["subtype"] === "init" && typeof data["session_id"] === "string") {
      return { kind: "session-init", sessionId: data["session_id"] };
    }
    if (
      data["subtype"] === "api_retry" &&
      typeof data["attempt"] === "number" &&
      typeof data["error"] === "string"
    ) {
      return { kind: "api-retry", attempt: data["attempt"], error: data["error"] };
    }
    // hook_* and other system events: ignored
    return null;
  }

  // assistant message — text + tool_use blocks
  if (data["type"] === "assistant" && isObject(data["message"])) {
    const blocks = toAssistantBlocks(data["message"]["content"]);
    if (blocks.length > 0) {
      return { kind: "assistant-message", blocks };
    }
    return null;
  }

  // user message — extract tool_results (input messages echoed by --replay-user-messages
  // would have other shapes; here we only care about tool_result content blocks)
  if (data["type"] === "user" && isObject(data["message"])) {
    const content = data["message"]["content"];
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          isObject(block) &&
          block["type"] === "tool_result" &&
          typeof block["tool_use_id"] === "string"
        ) {
          return {
            kind: "tool-result",
            toolUseId: block["tool_use_id"],
            content: extractToolResultText(block["content"]),
            isError: block["is_error"] === true,
          };
        }
      }
    }
    return null;
  }

  // result — turn completed
  if (data["type"] === "result") {
    const usage = safeReadUsage(data["usage"]);
    const model = readModel(data);
    const event: ParsedEvent = { kind: "turn-complete" };
    if (usage !== undefined) event.usage = usage;
    if (model !== undefined) event.model = model;
    return event;
  }

  // legacy partial-message stream events (still emitted with --include-partial-messages)
  if (data["type"] === "stream_event" && isObject(data["event"])) {
    const ev = data["event"];
    if (ev["type"] === "content_block_start" && isObject(ev["content_block"])) {
      const cb = ev["content_block"];
      if (
        cb["type"] === "tool_use" &&
        typeof cb["id"] === "string" &&
        typeof cb["name"] === "string"
      ) {
        return {
          kind: "assistant-message",
          blocks: [
            {
              kind: "tool-use",
              id: cb["id"],
              name: cb["name"],
              input: cb["input"] ?? {},
            },
          ],
        };
      }
    }
    // text-deltas and message_stop are intentionally ignored — we use the consolidated
    // assistant-message event instead, which contains the full content.
    return null;
  }

  if (data["type"] === "rate_limit_event") {
    const retryAfter =
      typeof data["retry_after"] === "number" && Number.isFinite(data["retry_after"])
        ? Math.floor(data["retry_after"])
        : null;
    const msg =
      typeof data["message"] === "string"
        ? data["message"]
        : "Rate limit reached. Pausing the agent.";
    return { kind: "rate-limited", retryAfterSec: retryAfter, message: msg };
  }

  return { kind: "unknown", raw: data };
};
