import { describe, expect, it } from "vitest";
import { mapToolUseToAction } from "../src/orchestrator/current-action-mapper.js";

describe("mapToolUseToAction", () => {
  it("Read shows 'Reading <basename>'", () => {
    expect(mapToolUseToAction("Read", { file_path: "/home/user/project/src/index.ts" })).toBe(
      "Reading index.ts",
    );
  });

  it("Read with Windows path", () => {
    expect(mapToolUseToAction("Read", { file_path: "C:\\Users\\h\\proj\\config.json" })).toBe(
      "Reading config.json",
    );
  });

  it("Read with missing path falls back to 'Reading file'", () => {
    expect(mapToolUseToAction("Read", {})).toBe("Reading file");
  });

  it("Edit shows 'Editing <basename>'", () => {
    expect(
      mapToolUseToAction("Edit", { file_path: "/tmp/notes.md", old_string: "x", new_string: "y" }),
    ).toBe("Editing notes.md");
  });

  it("Write shows 'Editing <basename>'", () => {
    expect(mapToolUseToAction("Write", { file_path: "/tmp/out.txt", content: "" })).toBe(
      "Editing out.txt",
    );
  });

  it("MultiEdit shows 'Editing <basename>'", () => {
    expect(mapToolUseToAction("MultiEdit", { file_path: "/tmp/a.ts", edits: [] })).toBe(
      "Editing a.ts",
    );
  });

  it("Bash never leaks the command", () => {
    expect(mapToolUseToAction("Bash", { command: "rm -rf / # haha", description: "delete" })).toBe(
      "Running shell",
    );
  });

  it("Glob and Grep show 'Searching'", () => {
    expect(mapToolUseToAction("Glob", { pattern: "**/*" })).toBe("Searching");
    expect(mapToolUseToAction("Grep", { pattern: "TODO" })).toBe("Searching");
  });

  it("dashboard MCP tool shows 'Talking to dashboard'", () => {
    expect(mapToolUseToAction("mcp__dashboard__send_message", { content: "hi" })).toBe(
      "Talking to dashboard",
    );
    expect(mapToolUseToAction("mcp__dashboard__hire_agent", { name: "x" })).toBe(
      "Talking to dashboard",
    );
  });

  it("unknown tool falls back to 'Using <name>'", () => {
    expect(mapToolUseToAction("SomethingNew", {})).toBe("Using SomethingNew");
  });

  it("output is capped to 80 chars", () => {
    const longName = "veryLong".repeat(20);
    const out = mapToolUseToAction(longName, {});
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it("basename truncates long filenames to 60 chars", () => {
    const path = "/tmp/" + "x".repeat(200) + ".ts";
    const out = mapToolUseToAction("Read", { file_path: path });
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.startsWith("Reading ")).toBe(true);
  });
});
