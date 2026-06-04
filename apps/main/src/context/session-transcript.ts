import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Distills a claude CLI on-disk session transcript (the per-agent
// <CLAUDE_CONFIG_DIR>/projects/<encoded-cwd>/<sessionId>.jsonl) into a compact,
// human-readable transcript for compaction. This is the REAL working session —
// tool calls, file reads, results, reasoning outcomes — which the chat-messages
// trail (buildRecoveryTrail) never captures. The digest distilled from it is
// therefore grounded in what the agent actually did, not just what it said in
// chat.
//
// Robustness is the whole game: claude's session format drifts between CLI
// versions, so every parse is defensive and the IO entry point returns null on
// ANY failure (missing file, unreadable, unparseable, empty) so the caller can
// fall back to the chat trail. Compaction must never silently degrade because an
// upstream format changed.

export type ParseOptions = {
  // Cap on the rendered transcript size. The TAIL is kept (most recent work is
  // what seeds the next turn's task state).
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 20_000;
// Any single tool input or result is truncated to this — a file read or grep
// dump can be huge, and the durable facts are distilled by the model anyway.
const MAX_BLOCK_CHARS = 1_000;

type Block = {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
};
type Line = { type?: string; message?: { role?: string; content?: unknown } };

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max)}…[+${s.length - max} chars]` : s;

// A tool_result `content` is either a plain string or an array of
// { type:"text", text } blocks. Pull the text out of either shape.
const toolResultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b !== null && typeof b === "object" && typeof (b as Block).text === "string"
          ? (b as Block).text
          : "",
      )
      .filter((t) => t !== "")
      .join("\n");
  }
  return "";
};

// Renders one session line into zero or more transcript entries. Only `user` and
// `assistant` lines carry signal; `thinking` blocks and noise line types
// (mode/attachment/ai-title/file-history-snapshot/system/summary) are dropped.
const renderLine = (line: Line): string[] => {
  const t = line.type;
  if (t !== "user" && t !== "assistant") return [];
  const speaker = t === "user" ? "User" : "Assistant";
  const content = line.message?.content;
  const out: string[] = [];

  if (typeof content === "string") {
    if (content.trim() !== "") out.push(`${speaker}: ${content}`);
    return out;
  }
  if (!Array.isArray(content)) return out;

  for (const raw of content) {
    if (raw === null || typeof raw !== "object") continue;
    const b = raw as Block;
    switch (b.type) {
      case "text":
        if (typeof b.text === "string" && b.text.trim() !== "") out.push(`${speaker}: ${b.text}`);
        break;
      case "tool_use": {
        const input =
          b.input === undefined ? "" : truncate(JSON.stringify(b.input), MAX_BLOCK_CHARS);
        out.push(`Tool call: ${b.name ?? "?"} ${input}`.trimEnd());
        break;
      }
      case "tool_result": {
        const text = toolResultText(b.content);
        if (text.trim() !== "") out.push(`Tool result: ${truncate(text, MAX_BLOCK_CHARS)}`);
        break;
      }
      // thinking + any other block type: intentionally skipped.
    }
  }
  return out;
};

// Pure: raw JSONL string → compact transcript string ("" when nothing useful).
export const parseSessionTranscript = (raw: string, opts: ParseOptions = {}): string => {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const entries: string[] = [];
  for (const ln of raw.split("\n")) {
    if (ln.trim() === "") continue;
    let parsed: Line;
    try {
      parsed = JSON.parse(ln) as Line;
    } catch {
      continue; // malformed line — skip, never throw
    }
    for (const e of renderLine(parsed)) entries.push(e);
  }
  if (entries.length === 0) return "";

  // Keep the most recent entries within budget.
  let total = 0;
  const kept: string[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const len = entry.length + 1; // +1 for the joining newline
    if (total + len > maxChars && kept.length > 0) {
      kept.unshift("…[earlier session truncated]");
      break;
    }
    kept.unshift(entry);
    total += len;
  }
  return kept.join("\n");
};

// Locates <configDir>/projects/<encoded-cwd>/<sessionId>.jsonl. claude encodes
// the agent's CWD into the project subdir name; rather than replicate that
// encoding we scan the subdirs for the file (mirrors sessionTranscriptExists in
// prepare-sandbox.ts).
const findSessionFile = (configDir: string, sessionId: string): string | null => {
  if (sessionId === "") return null;
  let subdirs: string[];
  try {
    subdirs = readdirSync(join(configDir, "projects"));
  } catch {
    return null;
  }
  const file = `${sessionId}.jsonl`;
  for (const sub of subdirs) {
    const p = join(configDir, "projects", sub, file);
    if (existsSync(p)) return p;
  }
  return null;
};

// IO: find + read + parse the agent's live session transcript. Returns null on
// ANY failure or when the transcript yields nothing — the caller falls back to
// the chat-messages trail so compaction never silently degrades.
export const readSessionTranscript = (
  configDir: string,
  sessionId: string,
  opts: ParseOptions = {},
): string | null => {
  const path = findSessionFile(configDir, sessionId);
  if (path === null) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const out = parseSessionTranscript(raw, opts);
  return out === "" ? null : out;
};
