import { describe, it, expect, afterEach } from "vitest";
import { budgetFor, tokenjuiceConfig } from "./config.js";

describe("config", () => {
  afterEach(() => {
    tokenjuiceConfig.perToolBudgetChars = {};
  });
  it("defaults to defaultBudgetChars", () => {
    expect(budgetFor("anything")).toBe(tokenjuiceConfig.defaultBudgetChars);
  });
  it("uses a per-tool override when present", () => {
    tokenjuiceConfig.perToolBudgetChars["isa_read"] = 500;
    expect(budgetFor("isa_read")).toBe(500);
  });
});
