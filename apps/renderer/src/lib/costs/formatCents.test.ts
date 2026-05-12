import { describe, expect, it } from "vitest";
import { formatCents, formatTokens } from "./formatCents.js";

describe("formatCents", () => {
  it("formats whole dollars with $ prefix and 2 decimals", () => {
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(99)).toBe("$0.99");
  });

  it("formats zero as $0.00", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats large amounts with comma separators (en-US locale)", () => {
    expect(formatCents(1_234_567)).toBe("$12,345.67");
  });

  it("handles negative cents gracefully (clamps to 0)", () => {
    expect(formatCents(-50)).toBe("$0.00");
  });
});

describe("formatTokens", () => {
  it("formats < 1000 as raw number", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats >= 1000 with k suffix and 1 decimal", () => {
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(9_999)).toBe("10.0k");
  });

  it("formats >= 1M with M suffix", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(12_345_678)).toBe("12.3M");
  });

  it("handles negative as 0", () => {
    expect(formatTokens(-10)).toBe("0");
  });
});
