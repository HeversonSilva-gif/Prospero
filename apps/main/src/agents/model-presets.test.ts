import { describe, it, expect } from "vitest";
import { resolveModelPreset, MODEL_PRESETS } from "./model-presets.js";

describe("resolveModelPreset", () => {
  it("maps each abstract preset to a real Claude model id", () => {
    expect(resolveModelPreset("opus-4")).toBe("claude-opus-4-8");
    expect(resolveModelPreset("sonnet-4")).toBe("claude-sonnet-4-6");
    expect(resolveModelPreset("haiku-4")).toBe("claude-haiku-4-5-20251001");
    expect(resolveModelPreset("opus-4-thinking")).toBe("claude-opus-4-8");
    expect(resolveModelPreset("sonnet-4-thinking")).toBe("claude-sonnet-4-6");
  });
  it("passes a real claude-* id through unchanged (defensive)", () => {
    expect(resolveModelPreset("claude-opus-4-7")).toBe("claude-opus-4-7");
  });
  it("falls back to sonnet for an unknown value", () => {
    expect(resolveModelPreset("bogus")).toBe("claude-sonnet-4-6");
  });
  it("exposes the five presets", () => {
    expect(MODEL_PRESETS).toEqual([
      "opus-4",
      "sonnet-4",
      "haiku-4",
      "opus-4-thinking",
      "sonnet-4-thinking",
    ]);
  });
});
