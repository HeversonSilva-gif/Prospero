import { describe, it, expect } from "vitest";
import { buildClaudeArgs } from "./build-args.js";
import type { Agent } from "@prospero/shared";

const ceo = (): Agent =>
  ({
    id: "ceo1",
    companyId: "c1",
    name: "CEO",
    role: "ceo",
    templateId: "ceo",
    systemPrompt: "You are the CEO.",
    capabilities: [],
    canHire: true,
    canAssign: true,
    model: "claude-sonnet-4-6",
    claudeSessionId: null,
  }) as unknown as Agent;

const systemPromptOf = (args: string[]): string => {
  const i = args.indexOf("--system-prompt");
  return i === -1 ? "" : (args[i + 1] ?? "");
};

describe("buildClaudeArgs — CEO capability boundary (audit 2026-06-03)", () => {
  it("threads opts.capabilityBoundary into the CEO genesis prompt (not a hardcoded ['x'])", () => {
    const args = buildClaudeArgs(ceo(), null, {
      capabilityBoundary: "MARKER_BOUNDARY_TEXT_123",
    });
    expect(systemPromptOf(args)).toContain("MARKER_BOUNDARY_TEXT_123");
  });

  it("falls back to a default boundary when none is provided", () => {
    const args = buildClaudeArgs(ceo(), null, {});
    // The default boundary prose still renders (back-compat) — it just isn't
    // grounded in the company's real connectors.
    expect(systemPromptOf(args)).toContain("Marketing channels you can operate now");
  });

  it("does not inject a capability boundary for a non-CEO agent", () => {
    const worker = { ...ceo(), role: "engineer", templateId: "role-engineer" } as Agent;
    const args = buildClaudeArgs(worker, null, {
      capabilityBoundary: "MARKER_BOUNDARY_TEXT_123",
    });
    expect(systemPromptOf(args)).not.toContain("MARKER_BOUNDARY_TEXT_123");
  });
});
