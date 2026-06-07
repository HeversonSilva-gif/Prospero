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
    // STREAM (not .create): the CEO can emit long turns (genesis/org plans, long
    // narration) and at max_tokens=64000 a non-streaming request risks an HTTP
    // timeout. `.stream().finalMessage()` assembles the full Message without that
    // risk. Cast through unknown to our narrower SdkCreateFn return shape (the SDK's
    // content blocks are structurally `{type, ...}`; stop_reason can be null).
    return client.messages
      .stream(params as Anthropic.MessageStreamParams)
      .finalMessage() as unknown as ReturnType<SdkCreateFn>;
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

      // The STABLE prefix carries the 1h cache breakpoint; the VOLATILE suffix
      // (digest/telos/project-context) follows it UNcached. So when the digest
      // changes between the CEO's wakes, only the small suffix is re-processed —
      // the big cached prefix (persona + capabilities + tools) still reads from
      // cache instead of paying a 2× cache write. stable+volatile is byte-identical
      // to the CLI's single system string (same content, same order).
      const system: Array<Record<string, unknown>> = [
        { type: "text", text: req.system, cache_control: CACHE_1H },
      ];
      if (req.systemVolatile !== undefined && req.systemVolatile !== "") {
        system.push({ type: "text", text: req.systemVolatile });
      }

      const params = {
        model: req.model,
        // 64000 (not 16000): the CLI CEO had no output ceiling; a too-low cap would
        // silently truncate a long genesis/org plan mid-turn. Paired with streaming
        // (realCreate) so the larger budget can't cause an HTTP timeout.
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        // Match Claude Code's default effort on Opus 4.7/4.8 (xhigh) so the SDK CEO
        // reasons exactly as hard as the CLI CEO. Omitting effort defaults to `high`
        // — a silent intelligence downgrade, which violates "don't make anyone dumber".
        output_config: { effort: "xhigh" },
        system,
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
