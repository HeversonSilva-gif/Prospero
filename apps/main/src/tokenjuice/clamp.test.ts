import { describe, it, expect } from "vitest";
import { clamp } from "./clamp.js";

const opts = (budgetChars: number) => ({
  budgetChars,
  maxFieldChars: 800,
  maxArrayItems: 20,
  toolName: "demo_tool",
});

describe("clamp", () => {
  it("keeps valid JSON valid after trimming an array", () => {
    const input = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => i) });
    const out = clamp(input, opts(120));
    expect(out.mode).toBe("json");
    const parsed = JSON.parse(out.text) as { items: unknown[] };
    expect(parsed.items.length).toBe(21); // 20 kept + 1 sentinel
    expect(String(parsed.items[20])).toContain("itens omitidos");
  });

  it("suffixes long string fields with a marker", () => {
    const input = JSON.stringify({ body: "x".repeat(2000) });
    const out = clamp(input, opts(900));
    const parsed = JSON.parse(out.text) as { body: string };
    expect(parsed.body).toContain("…[+1200 chars]");
  });

  it("head/tail truncates non-JSON text", () => {
    const input = "PLAIN " + "a".repeat(20_000);
    const out = clamp(input, opts(1000));
    expect(out.mode).toBe("text");
    expect(out.text).toContain("chars omitidos");
    expect(out.text.length).toBeLessThan(input.length);
  });

  it("falls back to a valid summary object when still over budget", () => {
    const input = JSON.stringify(
      Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, "y".repeat(50)])),
    );
    const out = clamp(input, opts(40)); // impossibly small
    const parsed = JSON.parse(out.text) as { _truncated?: boolean; topLevelKeys?: string[] };
    expect(parsed._truncated).toBe(true);
    expect(Array.isArray(parsed.topLevelKeys)).toBe(true);
  });
});
