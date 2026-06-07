import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmResponse } from "./agentic-loop.js";
import type { SdkToolDef } from "./tool-bridge.js";

// The injectable seam: defaults to the real SDK's messages.create. Tests pass a
// fake so no network call happens. Params are `unknown` because we build the
// Anthropic request shape ourselves (with 1h cache_control breakpoints) and the
// SDK's param type is broad; the result is the subset of `Message` we map from.
export type SdkCreateFn = (params: unknown) => Promise<{
  stop_reason: string | null;
  content: Array<{ type: string; [k: string]: unknown }>;
  usage?: Record<string, number>;
}>;

const CACHE_1H = { type: "ephemeral", ttl: "1h" } as const;

const realCreate =
  (apiKey: string): SdkCreateFn =>
  (params) => {
    const client = new Anthropic({ apiKey });
    // The SDK's content blocks are structurally `{type, ...}` and stop_reason can
    // be null; cast through unknown to our narrower SdkCreateFn return shape.
    return client.messages.create(
      params as Anthropic.MessageCreateParamsNonStreaming,
    ) as unknown as ReturnType<SdkCreateFn>;
  };

export const createSdkClient = (apiKey: string, deps?: { create?: SdkCreateFn }): LlmClient => {
  const create = deps?.create ?? realCreate(apiKey);

  return {
    createMessage: async (req): Promise<LlmResponse> => {
      // 1h cache on the whole tools block: put the breakpoint on the LAST tool
      // (tools render before system, so this caches the entire tool list).
      const tools = req.tools.map((t: SdkToolDef, i: number) => {
        const base = {
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        };
        return i === req.tools.length - 1 ? { ...base, cache_control: CACHE_1H } : base;
      });

      const params = {
        model: req.model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        // 1h cache on the stable system prefix — the cost win. No beta header
        // is required for the 1h ttl.
        system: [{ type: "text", text: req.system, cache_control: CACHE_1H }],
        tools,
        messages: req.messages,
      };

      const res = await create(params);

      // exactOptionalPropertyTypes: only set `usage` when the SDK returned it.
      const out: LlmResponse = {
        stop_reason: res.stop_reason ?? "end_turn",
        content: res.content,
      };
      if (res.usage !== undefined) out.usage = res.usage;
      return out;
    },
  };
};
