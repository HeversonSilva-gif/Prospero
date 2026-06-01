import { describe, it, expect } from "vitest";
import { isReadOnlyTool } from "./read-only-tools.js";

describe("isReadOnlyTool", () => {
  // Built-in Claude tools — only the literal read-only ones.
  it("Read is read-only", () => expect(isReadOnlyTool("Read")).toBe(true));
  it("Glob is read-only", () => expect(isReadOnlyTool("Glob")).toBe(true));
  it("Grep is read-only", () => expect(isReadOnlyTool("Grep")).toBe(true));
  it("Write is NOT read-only", () => expect(isReadOnlyTool("Write")).toBe(false));
  it("Edit is NOT read-only", () => expect(isReadOnlyTool("Edit")).toBe(false));
  it("Bash is NOT read-only", () => expect(isReadOnlyTool("Bash")).toBe(false));
  it("MultiEdit is NOT read-only", () => expect(isReadOnlyTool("MultiEdit")).toBe(false));
  it("NotebookEdit is NOT read-only", () => expect(isReadOnlyTool("NotebookEdit")).toBe(false));

  // MCP tools — list_*, allowlisted *_read.
  it("list_agents is read-only (list_ prefix)", () =>
    expect(isReadOnlyTool("list_agents")).toBe(true));
  it("list_issues is read-only (list_ prefix)", () =>
    expect(isReadOnlyTool("list_issues")).toBe(true));
  it("isa_read is read-only (allowlisted)", () => expect(isReadOnlyTool("isa_read")).toBe(true));
  it("telos_read is read-only (allowlisted)", () =>
    expect(isReadOnlyTool("telos_read")).toBe(true));
  it("skill_read is read-only (allowlisted)", () =>
    expect(isReadOnlyTool("skill_read")).toBe(true));
  it("memory_read is read-only (allowlisted)", () =>
    expect(isReadOnlyTool("memory_read")).toBe(true));

  // MCP tools that DO have side effects must NOT match.
  it("hire_agent is NOT read-only", () => expect(isReadOnlyTool("hire_agent")).toBe(false));
  it("create_issue is NOT read-only", () => expect(isReadOnlyTool("create_issue")).toBe(false));
  it("update_issue is NOT read-only", () => expect(isReadOnlyTool("update_issue")).toBe(false));
  it("criterion_judge is NOT read-only (write-style judgment)", () =>
    expect(isReadOnlyTool("criterion_judge")).toBe(false));
  it("submit_goal_plan is NOT read-only", () =>
    expect(isReadOnlyTool("submit_goal_plan")).toBe(false));
  // Money-moving Stripe tools must NEVER be trust-auto-approved (P5.2).
  it("setup_monetization is NOT read-only", () =>
    expect(isReadOnlyTool("mcp__dashboard__setup_monetization")).toBe(false));
  it("create_payment_link is NOT read-only", () =>
    expect(isReadOnlyTool("mcp__dashboard__create_payment_link")).toBe(false));

  // Edge cases.
  it("unknown tool defaults to NOT read-only (conservative)", () =>
    expect(isReadOnlyTool("definitely_not_a_real_tool")).toBe(false));
  it("empty string is NOT read-only", () => expect(isReadOnlyTool("")).toBe(false));
});
