import { describe, expect, it, vi } from "vitest";
import { createSdkClient, type SdkCreateFn } from "./sdk-client.js";

// Typed fake of the injectable seam: gives `.mock.calls[n][0]` a `params: unknown`
// type (vitest infers no params from a bare `vi.fn(() => ...)`), so we can capture
// the request the adapter built without fighting empty-tuple call types.
const fakeCreate = (
  result: Awaited<ReturnType<SdkCreateFn>>,
): SdkCreateFn & { lastParams: () => Record<string, unknown> } => {
  const fn = vi.fn<SdkCreateFn>(() => Promise.resolve(result));
  return Object.assign(fn, {
    lastParams: () => (fn.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>,
  });
};

describe("createSdkClient", () => {
  it("applies 1h cache_control to system + last tool and maps the response", async () => {
    const create = fakeCreate({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 1 },
    });
    const client = createSdkClient("sk-ant-x", { create });
    const res = await client.createMessage({
      model: "claude-opus-4-8",
      system: "SYS",
      tools: [
        { name: "a", description: "d", input_schema: { type: "object" } },
        { name: "b", description: "d", input_schema: { type: "object" } },
      ],
      messages: [{ role: "user", content: "go" }],
    });
    const params = create.lastParams();
    const system = params.system as Array<Record<string, unknown>>;
    const tools = params.tools as Array<Record<string, unknown>>;
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(system[0]!.text).toBe("SYS");
    expect(tools.at(-1)!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // only the LAST tool carries cache_control
    expect(tools[0]!.cache_control).toBeUndefined();
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.max_tokens).toBe(64000);
    // effort matches Claude Code's xhigh default so the SDK CEO isn't dumbed down
    expect(params.output_config).toEqual({ effort: "xhigh" });
    expect(res.stop_reason).toBe("end_turn");
    expect(res.content).toEqual([{ type: "text", text: "hi" }]);
    expect(res.usage).toEqual({ input_tokens: 1 });
  });

  it("passes through model and messages", async () => {
    const create = fakeCreate({ stop_reason: "end_turn", content: [], usage: {} });
    const client = createSdkClient("sk-ant-x", { create });
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: [{ type: "text", text: "hi" }] },
    ];
    await client.createMessage({
      model: "claude-opus-4-8",
      system: "S",
      tools: [],
      messages,
    });
    const params = create.lastParams();
    expect(params.model).toBe("claude-opus-4-8");
    expect(params.messages).toEqual(messages);
  });

  it("maps a null stop_reason from the SDK to end_turn", async () => {
    const create = fakeCreate({ stop_reason: null, content: [{ type: "text", text: "x" }] });
    const client = createSdkClient("sk-ant-x", { create });
    const res = await client.createMessage({
      model: "claude-opus-4-8",
      system: "S",
      tools: [],
      messages: [{ role: "user", content: "go" }],
    });
    expect(res.stop_reason).toBe("end_turn");
  });

  it("omits usage when the SDK returns no usage (exactOptionalPropertyTypes)", async () => {
    const create = fakeCreate({ stop_reason: "end_turn", content: [{ type: "text", text: "x" }] });
    const client = createSdkClient("sk-ant-x", { create });
    const res = await client.createMessage({
      model: "claude-opus-4-8",
      system: "S",
      tools: [],
      messages: [{ role: "user", content: "go" }],
    });
    expect("usage" in res).toBe(false);
  });

  it("does not attach cache_control when there are no tools", async () => {
    const create = fakeCreate({ stop_reason: "end_turn", content: [], usage: {} });
    const client = createSdkClient("sk-ant-x", { create });
    await client.createMessage({
      model: "claude-opus-4-8",
      system: "S",
      tools: [],
      messages: [{ role: "user", content: "go" }],
    });
    const params = create.lastParams();
    expect(params.tools).toEqual([]);
  });
});
