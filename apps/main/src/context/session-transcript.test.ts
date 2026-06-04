import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionTranscript, readSessionTranscript } from "./session-transcript.js";

// Builds a JSONL string from an array of session-line objects.
const jsonl = (lines: unknown[]): string => lines.map((l) => JSON.stringify(l)).join("\n");

describe("parseSessionTranscript", () => {
  it("renders a user string message and an assistant text block", () => {
    const out = parseSessionTranscript(
      jsonl([
        { type: "user", message: { role: "user", content: "Fix the login bug." } },
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "On it." }] },
        },
      ]),
    );
    expect(out).toBe("User: Fix the login bug.\nAssistant: On it.");
  });

  it("captures tool calls (file reads/edits) and their results — the whole point", () => {
    const out = parseSessionTranscript(
      jsonl([
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/app.ts" } },
            ],
          },
        },
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "t1", content: "export const x = 1;" }],
          },
        },
      ]),
    );
    expect(out).toContain("Read");
    expect(out).toContain("/repo/app.ts");
    expect(out).toContain("export const x = 1;");
  });

  it("skips thinking blocks and noise line types", () => {
    const out = parseSessionTranscript(
      jsonl([
        { type: "mode", sessionId: "s", mode: "default" },
        { type: "ai-title", title: "whatever" },
        { type: "file-history-snapshot", snapshot: {} },
        {
          type: "assistant",
          message: {
            content: [
              { type: "thinking", thinking: "secret chain of thought", signature: "sig" },
              { type: "text", text: "Done." },
            ],
          },
        },
      ]),
    );
    expect(out).toBe("Assistant: Done.");
    expect(out).not.toContain("secret chain of thought");
  });

  it("extracts text from array-shaped tool_result content blocks", () => {
    const out = parseSessionTranscript(
      jsonl([
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "t9",
                content: [{ type: "text", text: "42 files matched" }],
              },
            ],
          },
        },
      ]),
    );
    expect(out).toContain("42 files matched");
  });

  it("ignores malformed lines without throwing", () => {
    const out = parseSessionTranscript(
      [
        "not json at all",
        "",
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }),
        "{ broken",
      ].join("\n"),
    );
    expect(out).toBe("Assistant: ok");
  });

  it("returns empty string when nothing useful is present", () => {
    const out = parseSessionTranscript(
      jsonl([
        { type: "mode", mode: "x" },
        { type: "system", subtype: "init", session_id: "s" },
      ]),
    );
    expect(out).toBe("");
  });

  it("keeps the most recent content when over the char budget", () => {
    const lines = [];
    for (let i = 0; i < 50; i++) {
      lines.push({
        type: "assistant",
        message: { content: [{ type: "text", text: `line ${i}` }] },
      });
    }
    const out = parseSessionTranscript(jsonl(lines), { maxChars: 100 });
    expect(out.length).toBeLessThanOrEqual(100 + 40); // budget + truncation marker
    expect(out).toContain("line 49"); // tail kept
    expect(out).not.toContain("line 0"); // head dropped
  });
});

describe("readSessionTranscript", () => {
  it("finds the session jsonl under projects/<encoded-cwd>/ and parses it", () => {
    const cfg = mkdtempSync(join(tmpdir(), "st-cfg-"));
    const encoded = join(cfg, "projects", "D--some-encoded-cwd");
    mkdirSync(encoded, { recursive: true });
    writeFileSync(
      join(encoded, "sess-123.jsonl"),
      jsonl([{ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }]),
      "utf8",
    );
    expect(readSessionTranscript(cfg, "sess-123")).toBe("Assistant: hi");
  });

  it("returns null when the session file does not exist", () => {
    const cfg = mkdtempSync(join(tmpdir(), "st-cfg-"));
    expect(readSessionTranscript(cfg, "nope")).toBeNull();
  });

  it("returns null when the session id is empty", () => {
    const cfg = mkdtempSync(join(tmpdir(), "st-cfg-"));
    expect(readSessionTranscript(cfg, "")).toBeNull();
  });

  it("returns null when the file exists but yields nothing useful", () => {
    const cfg = mkdtempSync(join(tmpdir(), "st-cfg-"));
    const encoded = join(cfg, "projects", "enc");
    mkdirSync(encoded, { recursive: true });
    writeFileSync(join(encoded, "empty.jsonl"), jsonl([{ type: "mode", mode: "x" }]), "utf8");
    expect(readSessionTranscript(cfg, "empty")).toBeNull();
  });
});
