 
import { describe, expect, it, vi } from "vitest";
import { toolDefinitions, type ToolContext } from "../src/mcp/tools.js";

const makeCtx = (emit = vi.fn()): ToolContext => ({
  agentId: "a",
  companyId: "c",
  emit,
});

describe("mcp tools (M3 mocks)", () => {
  it("list_agents emits and returns ok", async () => {
    const emit = vi.fn();
    const def = toolDefinitions.find((t) => t.name === "list_agents");
    expect(def).toBeDefined();
    const result = await def!.run({}, makeCtx(emit));
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(true);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: "list_agents.called" }));
  });

  it("hire_agent rejects empty role at parse time", () => {
    const def = toolDefinitions.find((t) => t.name === "hire_agent");
    expect(def).toBeDefined();
    expect(() => def!.inputSchema.parse({})).toThrow();
  });

  it("create_issue accepts optional fields", () => {
    const def = toolDefinitions.find((t) => t.name === "create_issue");
    expect(def).toBeDefined();
    const parsed = def!.inputSchema.parse({ project: "P", title: "T" }) as {
      title: string;
    };
    expect(parsed.title).toBe("T");
  });

  it("notify_user accepts optional requires_action", () => {
    const def = toolDefinitions.find((t) => t.name === "notify_user");
    expect(def).toBeDefined();
    const parsed = def!.inputSchema.parse({
      title: "Hi",
      requires_action: true,
    }) as { requires_action: boolean };
    expect(parsed.requires_action).toBe(true);
  });

  it("message_agent requires both fields", () => {
    const def = toolDefinitions.find((t) => t.name === "message_agent");
    expect(def).toBeDefined();
    expect(() => def!.inputSchema.parse({ agent: "a" })).toThrow();
    expect(() => def!.inputSchema.parse({ content: "c" })).toThrow();
  });
});
