import { describe, it, expect } from "vitest";
import { isDestructiveApproval } from "./destructive.js";

describe("isDestructiveApproval", () => {
  describe("tool_call", () => {
    it.each([
      ["Bash", true],
      ["Write", true],
      ["Edit", true],
      ["MultiEdit", true],
      ["NotebookEdit", true],
    ])("%s → destructive=%s", (toolName, expected) => {
      const payload = JSON.stringify({ tool_name: toolName, tool_input: {} });
      expect(isDestructiveApproval({ kind: "tool_call", payloadJson: payload })).toBe(expected);
    });

    it("MCP-prefixed Bash also destructive (prefix strip)", () => {
      const payload = JSON.stringify({ tool_name: "mcp__dashboard__Bash", tool_input: {} });
      expect(isDestructiveApproval({ kind: "tool_call", payloadJson: payload })).toBe(true);
    });

    it.each([
      ["mcp__dashboard__hire_agent"],
      ["mcp__dashboard__create_issue"],
      ["mcp__dashboard__update_issue"],
    ])(
      "substantive but non-destructive MCP tool %s → destructive=false (eligible to coalesce)",
      (toolName) => {
        const payload = JSON.stringify({ tool_name: toolName, tool_input: {} });
        expect(isDestructiveApproval({ kind: "tool_call", payloadJson: payload })).toBe(false);
      },
    );

    it("missing tool_name in payload → destructive=false (conservative; coalescing is cheaper than spurious wakes)", () => {
      expect(isDestructiveApproval({ kind: "tool_call", payloadJson: "{}" })).toBe(false);
    });

    it("malformed JSON payload → destructive=false (don't crash; fall through to coalescing)", () => {
      expect(isDestructiveApproval({ kind: "tool_call", payloadJson: "not json" })).toBe(false);
    });
  });

  describe("manager_request", () => {
    it("fire → destructive=true", () => {
      const payload = JSON.stringify({ topic: "fire", target_agent_id: "a1" });
      expect(isDestructiveApproval({ kind: "manager_request", payloadJson: payload })).toBe(true);
    });

    it("budget (over) → destructive=true", () => {
      const payload = JSON.stringify({ topic: "budget", over_limit: true });
      expect(isDestructiveApproval({ kind: "manager_request", payloadJson: payload })).toBe(true);
    });

    it("hire → destructive=false", () => {
      const payload = JSON.stringify({ topic: "hire" });
      expect(isDestructiveApproval({ kind: "manager_request", payloadJson: payload })).toBe(false);
    });

    it("topic missing → destructive=false (conservative)", () => {
      expect(isDestructiveApproval({ kind: "manager_request", payloadJson: "{}" })).toBe(false);
    });
  });
});
