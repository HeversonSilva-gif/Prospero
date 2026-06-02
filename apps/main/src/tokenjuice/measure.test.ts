import { describe, it, expect } from "vitest";
import { countChars, estimateTokens } from "./measure.js";

describe("measure", () => {
  it("counts ASCII chars", () => {
    expect(countChars("hello")).toBe(5);
  });
  it("counts CJK as one grapheme each", () => {
    expect(countChars("中文")).toBe(2);
  });
  it("counts a combining-accent string by grapheme", () => {
    // "café" with precomposed é is 4
    expect(countChars("café")).toBe(4);
  });
  it("estimates tokens as ceil(chars/4)", () => {
    expect(estimateTokens(8)).toBe(2);
    expect(estimateTokens(10)).toBe(3);
    expect(estimateTokens(0)).toBe(0);
  });
});
