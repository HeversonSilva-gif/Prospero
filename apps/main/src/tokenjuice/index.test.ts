import { describe, it, expect, afterEach } from "vitest";
import { compressToolResult } from "./index.js";
import { shapers } from "./shapers.js";
import { tokenjuiceConfig } from "./config.js";

describe("compressToolResult", () => {
  afterEach(() => {
    shapers.clear();
    tokenjuiceConfig.perToolBudgetChars = {};
  });

  it("passes small payloads through untouched", () => {
    const out = compressToolResult({ toolName: "t", result: "tiny" });
    expect(out.text).toBe("tiny");
    expect(out.stats.mode).toBe("passthrough");
    expect(out.stats.clamped).toBe(false);
  });

  it("clamps an over-budget JSON array and keeps valid JSON", () => {
    const big = JSON.stringify({
      items: Array.from({ length: 5000 }, (_, i) => ({ i, s: "z".repeat(50) })),
    });
    const out = compressToolResult({ toolName: "list_goals", result: big });
    expect(out.stats.clamped).toBe(true);
    expect(out.stats.mode).toBe("json");
    expect(out.stats.reducedChars).toBeLessThan(out.stats.rawChars);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => JSON.parse(out.text)).not.toThrow();
  });

  it("applies a registered shaper", () => {
    shapers.set("isa_read", (parsed) => {
      const o = parsed as Record<string, unknown>;
      return { title: o.title }; // drop the heavy body
    });
    const input = JSON.stringify({ title: "T", body: "b".repeat(20_000) });
    const out = compressToolResult({ toolName: "isa_read", result: input });
    const parsed = JSON.parse(out.text) as Record<string, unknown>;
    expect(parsed.body).toBeUndefined();
    expect(parsed.title).toBe("T");
  });

  it("ignores a shaper that throws and never crashes", () => {
    shapers.set("boom", () => {
      throw new Error("nope");
    });
    const input = JSON.stringify({ a: "c".repeat(20_000) });
    expect(() => compressToolResult({ toolName: "boom", result: input })).not.toThrow();
  });

  it("returns passthrough when clamping barely helps", () => {
    tokenjuiceConfig.perToolBudgetChars["barely"] = 1000;
    const input = "P".repeat(1040); // non-JSON, > minSize, just over budget
    const out = compressToolResult({ toolName: "barely", result: input });
    expect(out.stats.clamped).toBe(false);
    expect(out.stats.mode).toBe("passthrough");
    expect(out.text).toBe(input);
  });
});
