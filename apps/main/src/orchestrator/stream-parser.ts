export type ParsedEvent =
  | { kind: "session-init"; sessionId: string }
  | { kind: "tool-use-start"; toolUseId: string; name: string; input: unknown }
  | { kind: "tool-result"; toolUseId: string; content: string }
  | { kind: "text-delta"; text: string }
  | { kind: "message-stop" }
  | { kind: "api-retry"; attempt: number; error: string }
  | { kind: "unknown"; raw: unknown };

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object";

export const parseStreamLine = (line: string): ParsedEvent | null => {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  const data = safeParse(trimmed);
  if (!isObject(data)) return null;

  if (data["type"] === "system" && data["subtype"] === "init") {
    const sid = data["session_id"];
    if (typeof sid === "string") return { kind: "session-init", sessionId: sid };
  }

  if (data["type"] === "system" && data["subtype"] === "api_retry") {
    const attempt = data["attempt"];
    const error = data["error"];
    if (typeof attempt === "number" && typeof error === "string")
      return { kind: "api-retry", attempt, error };
  }

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
          kind: "tool-use-start",
          toolUseId: cb["id"],
          name: cb["name"],
          input: cb["input"] ?? {},
        };
      }
    }
    if (ev["type"] === "content_block_delta" && isObject(ev["delta"])) {
      const d = ev["delta"];
      if (d["type"] === "text_delta" && typeof d["text"] === "string") {
        return { kind: "text-delta", text: d["text"] };
      }
    }
    if (ev["type"] === "message_stop") {
      return { kind: "message-stop" };
    }
  }

  if (data["type"] === "tool_result" && typeof data["tool_use_id"] === "string") {
    const content = data["content"];
    let textContent = "";
    if (typeof content === "string") textContent = content;
    else if (Array.isArray(content)) {
      const first: unknown = content[0];
      if (isObject(first) && typeof first["text"] === "string") textContent = first["text"];
    }
    return { kind: "tool-result", toolUseId: data["tool_use_id"], content: textContent };
  }

  return { kind: "unknown", raw: data };
};
