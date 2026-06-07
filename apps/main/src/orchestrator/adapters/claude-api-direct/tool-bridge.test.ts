import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../../db/migrations.js";
import { buildSdkTools, runTool } from "./tool-bridge.js";
import type { ToolContext } from "../../../mcp/tools.js";

const fakeCtx = (): ToolContext => {
  const db = new Database(":memory:");
  applyMigrations(db); // tools query real tables — migrate the in-memory db
  return {
    agentId: "ceo1",
    companyId: "c1",
    db,
    permissionsDir: "/tmp",
    userDataDir: "/tmp",
    emit: vi.fn(),
  };
};

describe("tool-bridge", () => {
  it("buildSdkTools returns SDK tool defs (name + description + JSON-schema input_schema)", () => {
    const tools = buildSdkTools(["delegation"]);
    const createGoal = tools.find((t) => t.name === "create_goal");
    expect(createGoal).toBeDefined();
    expect(createGoal!.description.length).toBeGreaterThan(0);
    expect(createGoal!.input_schema.type).toBe("object");
  });
  it("respects capability visibility (no connector tools for a delegation-only agent)", () => {
    expect(buildSdkTools(["delegation"]).some((t) => t.name === "post_to_x")).toBe(false);
  });
  it("runTool dispatches to the matching def and returns a string", async () => {
    // list_goals schema: z.object({ status: z.string().optional() }) — no required fields
    const out = await runTool("list_goals", {}, fakeCtx());
    expect(typeof out).toBe("string");
  });
  it("runTool throws a clear error for an unknown tool", async () => {
    await expect(runTool("nope_not_a_tool", {}, fakeCtx())).rejects.toThrow(/unknown tool/i);
  });

  it("honors run policy: canHire=false drops hire/fire tools", () => {
    expect(
      buildSdkTools(["delegation"], { canHire: true }).some((t) => t.name === "hire_agent"),
    ).toBe(true);
    expect(
      buildSdkTools(["delegation"], { canHire: false }).some((t) => t.name === "hire_agent"),
    ).toBe(false);
  });
});
