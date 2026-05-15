import type { WireMessage } from "../types/wire-protocol.js";

/** Serialize a wire message to a single newline-terminated line. */
export const encodeWireMessage = (msg: WireMessage): string => JSON.stringify(msg) + "\n";

/**
 * Parse one line into a WireMessage. Throws on malformed JSON or an envelope
 * that is not a valid request/response/notification. `JSON.parse` tolerates a
 * trailing newline, so a framed line may be passed with or without "\n".
 */
export const decodeWireMessage = (line: string): WireMessage => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`wire: malformed JSON: ${line.slice(0, 120)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("wire: message is not an object");
  }
  const m = parsed as Record<string, unknown>;
  switch (m["type"]) {
    case "request":
      if (typeof m["id"] !== "string" || typeof m["method"] !== "string") {
        throw new Error("wire: request missing id/method");
      }
      return parsed as WireMessage;
    case "response":
      if (typeof m["id"] !== "string") {
        throw new Error("wire: response missing id");
      }
      return parsed as WireMessage;
    case "notification":
      if (typeof m["method"] !== "string") {
        throw new Error("wire: notification missing method");
      }
      return parsed as WireMessage;
    default:
      throw new Error(`wire: unknown message type: ${String(m["type"])}`);
  }
};

/**
 * Reassembles newline-delimited lines from arbitrary stream chunks. A chunk may
 * carry zero, one, or many lines, and a line may span chunk boundaries.
 */
export class LineFramer {
  private buffer = "";

  /** Feed a chunk; return the lines it completed (newline stripped). */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      lines.push(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx + 1);
      idx = this.buffer.indexOf("\n");
    }
    return lines;
  }
}
